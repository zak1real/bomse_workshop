/*
 * Связка страницы со сценой: контент из data.js, скролл → положение лифта,
 * лифтовая панель, форма заявки.
 */
(function () {
    'use strict';

    var data = window.BOMSE || { contacts: {}, services: {}, works: [] };
    var contacts = data.contacts || {};
    var igUrl = 'https://www.instagram.com/' + (contacts.instagram || '') + '/';
    var igDirect = 'https://ig.me/m/' + (contacts.instagram || '');

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // ---------- Контент ----------

    document.querySelectorAll('[data-list]').forEach(function (list) {
        (data.services[list.dataset.list] || []).forEach(function (item) {
            var li = el('li');
            var row = el('div', 'price__row');
            row.appendChild(el('span', 'price__title', item.title));
            row.appendChild(el('span', 'price__dots'));
            row.appendChild(el('span', 'price__value', item.price || 'по запросу'));
            li.appendChild(row);
            if (item.note) li.appendChild(el('p', 'price__note', item.note));
            list.appendChild(li);
        });
    });

    var works = document.querySelector('[data-works]');
    if (works) {
        (data.works || []).forEach(function (work, index) {
            var li = el('li');
            if (work.image) {
                var img = el('img');
                img.src = work.image;
                img.alt = work.caption || 'Работа Bomse Workshop';
                img.loading = 'lazy';
                li.appendChild(img);
                if (work.caption) li.appendChild(el('span', 'works__cap', work.caption));
            } else {
                var blank = el('div', 'works__blank');
                blank.appendChild(el('b', '', '№ ' + String(index + 1).padStart(2, '0')));
                blank.appendChild(el('span', '', 'флеш-лист'));
                li.appendChild(blank);
            }
            works.appendChild(li);
        });
    }

    document.querySelectorAll('[data-ig-link]').forEach(function (a) { a.href = igUrl; });
    document.querySelectorAll('[data-address]').forEach(function (node) { node.textContent = contacts.address || ''; });

    var contactList = document.querySelector('[data-contacts]');
    if (contactList) {
        var rows = [];
        if (contacts.address) rows.push(['Адрес', contacts.address, contacts.mapUrl, contacts.place]);
        if (contacts.howToFind) rows.push(['Как найти', contacts.howToFind]);
        rows.push(['Часы', contacts.hours || 'По записи — уточняйте в директе']);
        if (contacts.phone) rows.push(['Телефон', contacts.phone, 'tel:' + contacts.phone.replace(/[^+\d]/g, '')]);
        if (contacts.telegram) rows.push(['Telegram', '@' + contacts.telegram, 'https://t.me/' + contacts.telegram]);
        if (contacts.instagram) rows.push(['Instagram', '@' + contacts.instagram, igUrl]);
        rows.forEach(function (row) {
            var wrap = el('div');
            wrap.appendChild(el('dt', '', row[0]));
            var dd = el('dd');
            if (row[2]) {
                var a = el('a', '', row[1]);
                a.href = row[2];
                if (row[2].indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
                dd.appendChild(a);
            } else {
                dd.textContent = row[1];
            }
            if (row[3]) dd.appendChild(el('small', '', row[3]));
            wrap.appendChild(dd);
            contactList.appendChild(wrap);
        });
    }

    // ---------- Скролл → лифт ----------

    var stops = Array.prototype.slice.call(document.querySelectorAll('main [data-stop]'));
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.lift__buttons a'));
    var root = document.documentElement;
    var mqMobile = window.matchMedia('(max-width: 860px)');
    var scene = null;
    var boxes = [];
    var activeStop = -1;

    function measure() {
        var y = window.scrollY;
        boxes = stops.map(function (node) {
            var r = node.getBoundingClientRect();
            return { top: r.top + y, bottom: r.bottom + y };
        });
    }

    function clamp01(v) { return Math.min(1, Math.max(0, v)); }

    function compute() {
        var vh = window.innerHeight;
        // Линия отсчёта: середина экрана, на телефоне — середина области с текстом под сценой
        var ref = window.scrollY + vh * (mqMobile.matches ? 0.66 : 0.5);
        var last = boxes.length - 1;
        var index = last, frac = 0;
        for (var i = 0; i < last; i++) {
            var gap = boxes[i + 1].top - boxes[i].bottom;
            var mid = (boxes[i].bottom + boxes[i + 1].top) / 2;
            var half = Math.max(gap / 2, vh * 0.22);
            if (ref < mid + half) {
                index = i;
                frac = clamp01((ref - (mid - half)) / (half * 2));
                break;
            }
        }
        function progress(n) {
            var b = boxes[Math.min(n, last)];
            return clamp01((ref - b.top) / Math.max(1, b.bottom - b.top));
        }
        return { t: index + frac, pA: progress(index), pB: index < last ? progress(index + 1) : 0 };
    }

    function update() {
        var state = compute();
        if (scene) scene.setState(state);

        var heroOut = clamp01(state.t);
        root.style.setProperty('--cut-a', (100 - heroOut * 61).toFixed(1) + '%');
        root.style.setProperty('--cut-b', (130 - heroOut * 83).toFixed(1) + '%');
        root.style.setProperty('--hero-shade', (1 - heroOut).toFixed(3));
        root.style.setProperty('--top-solid', Math.min(1, heroOut * 2).toFixed(3));
        root.style.setProperty('--needle', (-72 + Math.min(4, Math.max(0, state.t - 1)) * 36).toFixed(1) + 'deg');

        var nearest = Math.round(state.t);
        if (nearest !== activeStop) {
            activeStop = nearest;
            buttons.forEach(function (a) {
                var on = Number(a.dataset.stop) === nearest;
                a.classList.toggle('is-active', on);
                if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
            });
        }
    }

    var ticking = false;
    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () { ticking = false; update(); });
    }

    function onResize() { measure(); update(); }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('load', onResize);
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(document.querySelector('main'));

    // ---------- Сцена ----------

    function startScene() {
        var canvas = document.getElementById('shaft');
        scene = window.BomseScene && window.THREE ? window.BomseScene.init(canvas) : null;
        if (!scene) root.classList.add('no-webgl');
        window.__bomseScene = scene;
        onResize();
    }

    // Надписи в сцене рисуются шрифтом страницы, поэтому ждём его (но не дольше 1,5 с)
    var started = false;
    function startOnce() { if (!started) { started = true; startScene(); } }
    if (document.fonts && document.fonts.load) {
        Promise.all([
            document.fonts.load('800 60px "Sofia Sans Extra Condensed"', 'BOMSE ТАТУ'),
            document.fonts.load('500 20px "IBM Plex Mono"', '+3,45')
        ]).then(startOnce, startOnce);
        setTimeout(startOnce, 1500);
    } else {
        startOnce();
    }

    measure();
    update();

    // ---------- Форма ----------

    var form = document.querySelector('[data-form]');
    if (form) {
        var status = form.querySelector('.form__status');
        var submit = form.querySelector('button[type="submit"]');

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var ok = true;
            ['name', 'contact'].forEach(function (name) {
                var input = form.elements[name];
                var empty = !input.value.trim();
                input.closest('.field').classList.toggle('is-error', empty);
                if (empty && ok) { input.focus(); ok = false; }
            });
            if (!ok) {
                status.textContent = 'Заполните имя и контакт — иначе не сможем ответить.';
                return;
            }

            var fields = {
                service: form.elements.service.value,
                name: form.elements.name.value.trim(),
                contact: form.elements.contact.value.trim(),
                message: form.elements.message.value.trim()
            };
            var text = 'Запись: ' + fields.service + '\nИмя: ' + fields.name + '\nКонтакт: ' + fields.contact +
                (fields.message ? '\nЧто нужно: ' + fields.message : '');

            if (!data.web3formsKey) {
                // Без ключа почты: копируем заявку и ведём в директ
                var done = function (copied) {
                    status.innerHTML = '';
                    status.appendChild(document.createTextNode(copied ? 'Текст заявки скопирован. Вставьте его в ' : 'Напишите нам в '));
                    var a = el('a', '', 'директ Instagram');
                    a.href = igDirect; a.target = '_blank'; a.rel = 'noopener';
                    status.appendChild(a);
                    status.appendChild(document.createTextNode(copied ? ' — ответим там.' : ' — пришлите имя, контакт и что хотите сделать.'));
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
                } else {
                    done(false);
                }
                return;
            }

            submit.disabled = true;
            status.textContent = 'Отправляем…';
            fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    access_key: data.web3formsKey,
                    subject: 'Заявка с сайта Bomse Workshop: ' + fields.service,
                    from_name: 'Сайт Bomse Workshop',
                    name: fields.name,
                    contact: fields.contact,
                    service: fields.service,
                    message: fields.message || '—'
                })
            }).then(function (res) { return res.json(); }).then(function (json) {
                if (!json.success) throw new Error(json.message || 'fail');
                form.reset();
                status.textContent = 'Заявка ушла. Ответим в ближайшее время.';
            }).catch(function () {
                status.textContent = 'Не получилось отправить. Напишите нам в директ Instagram — @' + (contacts.instagram || '') + '.';
            }).then(function () { submit.disabled = false; });
        });
    }
})();
