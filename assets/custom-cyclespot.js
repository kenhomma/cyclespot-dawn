/**
 * CycleSpot — scroll-triggered fade-in animations
 * Uses IntersectionObserver to add .is-visible to .cs-fade-in elements
 */
(function () {
  'use strict';

  if (!('IntersectionObserver' in window)) return;

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px'
    }
  );

  function observeElements() {
    document.querySelectorAll('.cs-fade-in:not(.is-visible)').forEach(function (el) {
      observer.observe(el);
    });
  }

  /* Initial pass */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeElements);
  } else {
    observeElements();
  }

  /* Re-observe after Shopify section rendering (theme editor) */
  document.addEventListener('shopify:section:load', function () {
    setTimeout(observeElements, 100);
  });
})();
