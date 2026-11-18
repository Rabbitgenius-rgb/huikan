(() => {
  'use strict';
  function create(pet) {
    const videos = [...pet.querySelectorAll('video')];
    const clips = { take:'take-bag', open:'open-bag', hold:'hold-bag', close:'close-bag' };
    let front = null;
    function wait(video, event, limit) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(failure, limit);
        function finish(error) {
          clearTimeout(timer);
          video.removeEventListener(event, success);
          video.removeEventListener('error', failure);
          if (error) reject(error); else resolve();
        }
        function success() { finish(); }
        function failure() { finish(video.error || Error('角色视频未就绪')); }
        video.addEventListener(event, success, {once:true});
        video.addEventListener('error', failure, {once:true});
      });
    }
    function preload(name) {
      const target = videos[0] === front ? videos[1] : videos[0];
      if (target.dataset.clip !== name) {
        target.dataset.clip = name;
        target.src = 'media/' + clips[name] + '.webm';
        target.load();
      }
      return target;
    }
    function poster(name) {
      for (const video of videos) { video.pause(); video.removeAttribute('data-front'); }
      front = null;
      pet.dataset.poster = name;
      pet.dataset.clip = 'poster';
    }
    async function play(name, next) {
      const video = preload(name);
      if (video.error) throw video.error;
      if (video.readyState < 2) await wait(video, 'loadeddata', 3600);
      if (video.currentTime > 0) {
        const seek = wait(video, 'seeked', 1600);
        video.currentTime = 0;
        await seek;
      }
      video.loop = name === 'hold';
      await video.play();
      if (video.requestVideoFrameCallback) {
        await new Promise(resolve => {
          const id = video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
          const timer = setTimeout(() => { video.cancelVideoFrameCallback(id); resolve(); }, 120);
        });
      }
      const previous = front;
      front = video;
      video.setAttribute('data-front','');
      pet.removeAttribute('data-poster');
      pet.dataset.clip = name;
      if (previous) { previous.pause(); previous.removeAttribute('data-front'); }
      if (next) preload(next);
      if (!video.loop && !video.ended) await wait(video, 'ended', 5400);
    }
    return { play, preload, poster, setVisible(value) {
      if (!front?.loop) return;
      if (value) void front.play().catch(() => poster('hold')); else front.pause();
    } };
  }
  window.RecallBagPlayer = Object.freeze({ create });
})();
