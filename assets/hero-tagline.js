(function () {
  'use strict';

  function initHeroTagline(el) {
    var container = el.hasAttribute('data-hero-tagline') ? el : el.querySelector('[data-hero-tagline]');
    if (!container) return;

    var textEl = container.querySelector('[data-typing-text]');
    var cursorEl = container.querySelector('[data-typing-cursor]');
    var slides = container.querySelectorAll('[data-slide]');
    var dots = container.querySelectorAll('[data-dot]');

    if (!textEl) return;

    // Read phrases from data attribute
    var phrases = [];
    try {
      phrases = JSON.parse(container.getAttribute('data-phrases') || '[]');
    } catch (e) {
      return;
    }

    if (phrases.length === 0) return;

    var currentIndex = 0;
    var isTyping = false;
    var typeTimer = null;
    var cycleTimer = null;

    // Reduced motion check
    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setActiveSlide(index) {
      slides.forEach(function (s, i) {
        s.classList.toggle('is-active', i === index);
      });
      dots.forEach(function (d, i) {
        d.classList.toggle('is-active', i === index);
      });
    }

    function typeText(text, callback) {
      if (prefersReducedMotion) {
        textEl.textContent = text;
        if (callback) callback();
        return;
      }

      isTyping = true;
      textEl.textContent = '';
      var charIndex = 0;

      function typeChar() {
        if (charIndex < text.length) {
          textEl.textContent += text.charAt(charIndex);
          charIndex++;
          typeTimer = setTimeout(typeChar, 60);
        } else {
          isTyping = false;
          if (callback) callback();
        }
      }

      typeChar();
    }

    function eraseText(callback) {
      if (prefersReducedMotion) {
        textEl.textContent = '';
        if (callback) callback();
        return;
      }

      isTyping = true;
      function eraseChar() {
        var current = textEl.textContent;
        if (current.length > 0) {
          textEl.textContent = current.slice(0, -1);
          typeTimer = setTimeout(eraseChar, 30);
        } else {
          isTyping = false;
          if (callback) callback();
        }
      }

      eraseChar();
    }

    function nextPhrase() {
      eraseText(function () {
        currentIndex = (currentIndex + 1) % phrases.length;
        setActiveSlide(currentIndex);

        setTimeout(function () {
          typeText(phrases[currentIndex], function () {
            cycleTimer = setTimeout(nextPhrase, 4000);
          });
        }, 300);
      });
    }

    // Dot click handlers
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        if (isTyping) return;
        clearTimeout(typeTimer);
        clearTimeout(cycleTimer);

        eraseText(function () {
          currentIndex = i;
          setActiveSlide(currentIndex);
          setTimeout(function () {
            typeText(phrases[currentIndex], function () {
              cycleTimer = setTimeout(nextPhrase, 4000);
            });
          }, 300);
        });
      });
    });

    // Start: show first slide + type first phrase
    setActiveSlide(0);
    typeText(phrases[0], function () {
      cycleTimer = setTimeout(nextPhrase, 4000);
    });

    // Cleanup for theme editor
    return function cleanup() {
      clearTimeout(typeTimer);
      clearTimeout(cycleTimer);
    };
  }

  // Initialize on DOMContentLoaded
  function init() {
    document.querySelectorAll('.hero-tl').forEach(initHeroTagline);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Theme editor support
  document.addEventListener('shopify:section:load', function (e) {
    var section = e.target;
    if (section.querySelector('[data-hero-tagline]')) {
      initHeroTagline(section);
    }
  });
})();
