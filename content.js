(() => {
  "use strict";

  // Prevent accidental duplicate installation in the same frame.
  if (globalThis.__leftCtrlVideoSpeedToggleInstalled) return;
  globalThis.__leftCtrlVideoSpeedToggleInstalled = true;

  const TARGET_RATE = 2.5;
  const EPSILON = 0.001;

  let leftCtrlDown = false;
  let rightCtrlDown = false;
  let chordUsed = false;
  let boostState = null;
  let toastElement = null;
  let toastTimer = null;
  let adjustingRate = false;

  function isFinitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function formatRate(rate) {
    return Number(rate.toFixed(2)).toString();
  }

  function visibleArea(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 0;

    const style = getComputedStyle(video);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return 0;
    }

    const width = Math.max(
      0,
      Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)
    );
    const height = Math.max(
      0,
      Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
    );

    return width * height;
  }

  function scoreVideo(video) {
    let score = visibleArea(video);

    // Prefer Picture-in-Picture, fullscreen, and currently playing videos.
    if (document.pictureInPictureElement === video) {
      score += 3_000_000_000;
    }

    const fullscreenElement = document.fullscreenElement;
    if (
      fullscreenElement &&
      (fullscreenElement === video || fullscreenElement.contains(video))
    ) {
      score += 2_000_000_000;
    }

    if (!video.paused && !video.ended && video.readyState >= 2) {
      score += 1_000_000_000;
    }

    return score;
  }

  function findBestVideo() {
    const videos = Array.from(document.querySelectorAll("video")).filter(
      (video) => video.isConnected
    );

    if (videos.length === 0) return null;

    return videos.reduce((best, current) =>
      scoreVideo(current) > scoreVideo(best) ? current : best
    );
  }

  function showToast(message, isError = false) {
    if (!document.documentElement) return;

    if (!toastElement || !toastElement.isConnected) {
      toastElement = document.createElement("div");
      toastElement.setAttribute("role", "status");
      toastElement.setAttribute("aria-live", "polite");

      Object.assign(toastElement.style, {
        position: "fixed",
        top: "22px",
        right: "22px",
        zIndex: "2147483647",
        padding: "10px 14px",
        borderRadius: "10px",
        font: "600 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#ffffff",
        background: "rgba(20, 20, 24, 0.92)",
        boxShadow: "0 8px 28px rgba(0, 0, 0, 0.3)",
        backdropFilter: "blur(8px)",
        pointerEvents: "none",
        opacity: "0",
        transform: "translateY(-8px)",
        transition: "opacity 140ms ease, transform 140ms ease"
      });

      document.documentElement.appendChild(toastElement);
    }

    toastElement.textContent = message;
    toastElement.style.background = isError
      ? "rgba(170, 35, 35, 0.94)"
      : "rgba(20, 20, 24, 0.92)";
    toastElement.style.opacity = "1";
    toastElement.style.transform = "translateY(0)";

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (!toastElement) return;
      toastElement.style.opacity = "0";
      toastElement.style.transform = "translateY(-8px)";
    }, 1300);
  }

  function setVideoRate(video, playbackRate, defaultPlaybackRate = playbackRate) {
    video.playbackRate = playbackRate;
    video.defaultPlaybackRate = defaultPlaybackRate;
  }

  function enforceBoostedRate(event) {
    const video = event.currentTarget;

    if (
      adjustingRate ||
      !boostState ||
      boostState.video !== video ||
      Math.abs(video.playbackRate - TARGET_RATE) <= EPSILON
    ) {
      return;
    }

    adjustingRate = true;
    try {
      setVideoRate(video, TARGET_RATE);
    } finally {
      queueMicrotask(() => {
        adjustingRate = false;
      });
    }
  }

  function activateBoost(video) {
    const originalRate = isFinitePositive(video.playbackRate)
      ? video.playbackRate
      : 1;
    const originalDefaultRate = isFinitePositive(video.defaultPlaybackRate)
      ? video.defaultPlaybackRate
      : originalRate;

    boostState = {
      video,
      originalRate,
      originalDefaultRate
    };

    video.addEventListener("ratechange", enforceBoostedRate, true);

    try {
      setVideoRate(video, TARGET_RATE);
      showToast(`播放速度：${formatRate(TARGET_RATE)}×`);
    } catch (error) {
      video.removeEventListener("ratechange", enforceBoostedRate, true);
      boostState = null;
      showToast("这个网页不允许修改播放速度", true);
      console.warn("[Left Ctrl Video Speed Toggle]", error);
    }
  }

  function restoreOriginalSpeed() {
    const state = boostState;
    boostState = null;

    if (!state) return;

    state.video.removeEventListener("ratechange", enforceBoostedRate, true);

    // Normally restore the same video. If the site replaced its <video>
    // element, restore the best currently available video instead.
    const video = state.video.isConnected ? state.video : findBestVideo();

    if (!video) {
      showToast("已关闭 2.5×（当前找不到视频）");
      return;
    }

    try {
      setVideoRate(video, state.originalRate, state.originalDefaultRate);
      showToast(`已恢复：${formatRate(state.originalRate)}×`);
    } catch (error) {
      showToast("无法恢复原本播放速度", true);
      console.warn("[Left Ctrl Video Speed Toggle]", error);
    }
  }

  function toggleSpeed() {
    if (boostState) {
      restoreOriginalSpeed();
      return;
    }

    const video = findBestVideo();

    if (!video) {
      showToast("当前页面找不到 video", true);
      return;
    }

    activateBoost(video);
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.code === "ControlRight") {
        if (!event.repeat) rightCtrlDown = true;
        if (leftCtrlDown) chordUsed = true;
        return;
      }

      if (event.code === "ControlLeft") {
        if (event.repeat) return;

        leftCtrlDown = true;
        chordUsed =
          rightCtrlDown || event.shiftKey || event.altKey || event.metaKey;
        return;
      }

      // Any other key turns this into a keyboard shortcut/chord, such as
      // Ctrl+C, Ctrl+V, Ctrl+Tab, etc., so it must not toggle the speed.
      if (leftCtrlDown) chordUsed = true;
    },
    true
  );

  document.addEventListener(
    "keyup",
    (event) => {
      if (event.code === "ControlRight") {
        rightCtrlDown = false;
        return;
      }

      if (event.code !== "ControlLeft") return;

      const shouldToggle = leftCtrlDown && !chordUsed;
      leftCtrlDown = false;
      chordUsed = false;

      if (shouldToggle) toggleSpeed();
    },
    true
  );

  // Do not treat Ctrl+click, Ctrl+wheel, or context-menu gestures as a
  // standalone Left Ctrl press.
  for (const eventName of ["pointerdown", "wheel", "contextmenu"]) {
    document.addEventListener(
      eventName,
      () => {
        if (leftCtrlDown) chordUsed = true;
      },
      true
    );
  }

  window.addEventListener(
    "blur",
    () => {
      leftCtrlDown = false;
      rightCtrlDown = false;
      chordUsed = false;
    },
    true
  );
})();
