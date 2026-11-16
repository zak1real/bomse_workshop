/*
 * 3D-сцена: лифтовая шахта в разрезе, четыре комнаты одна над другой и крыша.
 * Вся геометрия и текстуры рисуются кодом — внешних моделей и картинок нет.
 * Наружу отдаётся window.BomseScene: init(canvas), setState({ t, pA, pB }).
 *   t  — «остановка» лифта: 0 общий план, 1–4 этажи, 5 крыша (дробные значения — в пути)
 *   pA — насколько прочитана текущая секция (0..1), pB — следующая
 */
(function () {
    'use strict';

    var T = window.THREE;

    // Размеры в метрах
    var W = 6, D = 4.4, H = 3, SLAB = 0.45, WALL = 0.5;
    var P = H + SLAB;          // шаг этажа
    var TOP = P * 4;           // уровень крыши
    var FOV = 32;

    var LABELS = ['1  ВХОД', '2  ПАРИКМАХЕРСКАЯ', '3  ТАТУ', '4  МАСТЕРСКАЯ', 'КРЫША'];
    var DISPLAY_FONT = '"Sofia Sans Extra Condensed", "Arial Narrow", Impact, sans-serif';

    // ---------- Утилиты ----------

    function rng(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
    function lerp(a, b, k) { return a + (b - a) * k; }
    function smoother(k) { k = clamp(k, 0, 1); return k * k * k * (k * (k * 6 - 15) + 10); }

    function makeTex(w, h, draw, rx, ry) {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        draw(c.getContext('2d'), w, h);
        var t = new T.CanvasTexture(c);
        t.colorSpace = T.SRGBColorSpace;
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.repeat.set(rx || 1, ry || 1);
        t.anisotropy = 4;
        return t;
    }

    function withRepeat(tex, rx, ry) {
        var t = tex.clone();
        t.repeat.set(rx, ry);
        t.needsUpdate = true;
        return t;
    }

    var BOX = new T.BoxGeometry(1, 1, 1);
    var PLANE = new T.PlaneGeometry(1, 1);
    var cylCache = {};

    function box(parent, w, h, d, mat, x, y, z) {
        var m = new T.Mesh(BOX, mat);
        m.scale.set(w, h, d);
        m.position.set(x, y, z);
        parent.add(m);
        return m;
    }

    function plane(parent, w, h, mat, x, y, z) {
        var m = new T.Mesh(PLANE, mat);
        m.scale.set(w, h, 1);
        m.position.set(x, y, z);
        parent.add(m);
        return m;
    }

    function cyl(parent, rTop, rBot, h, mat, x, y, z, seg) {
        seg = seg || 14;
        var key = (rTop / rBot).toFixed(3) + ':' + seg;
        var geo = cylCache[key];
        if (!geo) {
            geo = new T.CylinderGeometry(rTop / rBot, 1, 1, seg);
            cylCache[key] = geo;
        }
        var m = new T.Mesh(geo, mat);
        m.scale.set(rBot, h, rBot);
        m.position.set(x, y, z);
        parent.add(m);
        return m;
    }

    // ---------- Текстуры ----------

    function drawBricks(g, w, h, o) {
        var r = rng(o.seed || 1);
        g.fillStyle = o.mortar || '#2b211d';
        g.fillRect(0, 0, w, h);
        var rows = Math.round(h / o.bh);
        for (var row = 0; row < rows; row++) {
            var off = row % 2 ? o.bw / 2 : 0;
            for (var x = -o.bw; x < w; x += o.bw) {
                var k = 0.72 + r() * 0.5;
                var soot = r() < 0.07 ? 0.55 : 1;
                g.fillStyle = 'rgb(' + Math.round(o.base[0] * k * soot) + ',' + Math.round(o.base[1] * k * soot) + ',' + Math.round(o.base[2] * k * soot) + ')';
                g.fillRect(x + off + o.gap, row * o.bh + o.gap, o.bw - o.gap * 2, o.bh - o.gap * 2);
            }
        }
        for (var i = 0; i < (o.specks || 1800); i++) {
            g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,220,190,0.05)';
            g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
        }
    }

    function drawConcrete(g, w, h, base, seed) {
        var r = rng(seed || 7);
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);
        for (var i = 0; i < 2600; i++) {
            g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.04)';
            var s = 1 + r() * 3;
            g.fillRect(r() * w, r() * h, s, s);
        }
        for (var j = 0; j < 9; j++) {
            g.strokeStyle = 'rgba(0,0,0,0.12)';
            g.lineWidth = 1;
            g.beginPath();
            var x = r() * w, y = r() * h;
            g.moveTo(x, y);
            g.lineTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 60);
            g.stroke();
        }
    }

    function radialTex(inner, outer) {
        return makeTex(128, 128, function (g) {
            var grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
            grd.addColorStop(0, inner);
            grd.addColorStop(1, outer);
            g.fillStyle = grd;
            g.fillRect(0, 0, 128, 128);
        });
    }

    function textTex(w, h, draw) {
        var t = makeTex(w, h, draw);
        t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
        return t;
    }

    function neonTex(text, color, w, h, size) {
        return textTex(w, h, function (g) {
            g.font = '800 ' + size + 'px ' + DISPLAY_FONT;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.lineJoin = 'round';
            for (var i = 0; i < 3; i++) {
                g.shadowColor = color;
                g.shadowBlur = 34 - i * 10;
                g.strokeStyle = color;
                g.lineWidth = 7;
                g.strokeText(text, w / 2, h / 2 + 4);
            }
            g.shadowBlur = 0;
            g.strokeStyle = '#fff4ea';
            g.lineWidth = 2.5;
            g.strokeText(text, w / 2, h / 2 + 4);
        });
    }

    // ---------- Сборка сцены ----------

    function build(scene) {
        var updates = [];
        var tex = {};
        var M = {};

        tex.brick = makeTex(512, 512, function (g, w, h) {
            drawBricks(g, w, h, { bw: 64, bh: 32, gap: 2, base: [150, 74, 54], seed: 11 });
        });
        tex.brickDark = makeTex(512, 512, function (g, w, h) {
            drawBricks(g, w, h, { bw: 64, bh: 32, gap: 2, base: [70, 46, 44], mortar: '#151214', seed: 23 });
        });
        tex.concrete = makeTex(256, 256, function (g, w, h) { drawConcrete(g, w, h, '#5d5850', 3); });
        tex.concreteDark = makeTex(256, 256, function (g, w, h) { drawConcrete(g, w, h, '#2e2b2c', 5); });
        tex.checker = makeTex(128, 128, function (g) {
            g.fillStyle = '#d9d2c2'; g.fillRect(0, 0, 128, 128);
            g.fillStyle = '#1b1917'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
        });
        tex.wood = makeTex(256, 256, function (g, w, h) {
            var r = rng(41);
            for (var i = 0; i < 8; i++) {
                var k = 0.8 + r() * 0.35;
                g.fillStyle = 'rgb(' + Math.round(150 * k) + ',' + Math.round(104 * k) + ',' + Math.round(66 * k) + ')';
                g.fillRect(0, i * 32, w, 31);
                g.fillStyle = 'rgba(0,0,0,0.35)';
                g.fillRect(r() * w, i * 32, 2, 31);
                for (var j = 0; j < 14; j++) {
                    g.fillStyle = 'rgba(60,30,10,0.10)';
                    g.fillRect(r() * w, i * 32 + r() * 30, 30 + r() * 60, 1);
                }
            }
        });
        tex.glow = radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
        tex.blob = radialTex('rgba(0,0,0,0.62)', 'rgba(0,0,0,0)');

        function lam(color, map) { return new T.MeshLambertMaterial({ color: color, map: map || null }); }
        function phong(color, shin) { return new T.MeshPhongMaterial({ color: color, shininess: shin, specular: 0x555555 }); }
        function basic(color) { return new T.MeshBasicMaterial({ color: color, toneMapped: false }); }

        M.steel = phong(0x2c2d31, 50);
        M.chrome = phong(0xb4b8bf, 90);
        M.black = lam(0x141315);
        M.woodDark = lam(0x4b2f1f);
        M.wood = lam(0xffffff, tex.wood);
        M.leather = phong(0x6a2420, 25);
        M.leatherBlack = phong(0x1d1b1e, 30);
        M.white = lam(0xe6dfd0);
        M.cut = new T.MeshBasicMaterial({ color: 0x1e1310 });
        M.concrete = lam(0xffffff, tex.concrete);
        M.shadow = new T.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false });

        function glow(parent, color, size, x, y, z, opacity) {
            var s = new T.Sprite(new T.SpriteMaterial({
                map: tex.glow, color: color, transparent: true, opacity: opacity === undefined ? 0.7 : opacity,
                blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
            }));
            s.scale.set(size, size, 1);
            s.position.set(x, y, z);
            parent.add(s);
            return s;
        }

        function blob(parent, x, z, w, d) {
            var m = plane(parent, w, d, M.shadow, x, 0.012, z);
            m.rotation.x = -Math.PI / 2;
            return m;
        }

        function decal(parent, texture, w, h, x, y, z, additive) {
            var mat = new T.MeshBasicMaterial({
                map: texture, transparent: true, depthWrite: false, toneMapped: false,
                blending: additive ? T.AdditiveBlending : T.NormalBlending
            });
            return plane(parent, w, h, mat, x, y, z);
        }

        function pendant(parent, x, z, color) {
            cyl(parent, 0.008, 0.008, 0.6, M.black, x, H - 0.3, z, 6);
            cyl(parent, 0.05, 0.24, 0.18, M.black, x, H - 0.66, z, 16);
            var bulb = new T.Mesh(new T.SphereGeometry(0.06, 10, 8), basic(color));
            bulb.position.set(x, H - 0.76, z);
            parent.add(bulb);
            glow(parent, color, 1.5, x, H - 0.78, z, 0.55);
        }

        // ----- Оболочка: стены шахты, перекрытия, срезы -----

        var shellH = TOP + 1.2;
        var brickBack = lam(0xffffff, withRepeat(tex.brick, (W + WALL * 2) / 2, shellH / 1.2));
        var brickSide = lam(0xffffff, withRepeat(tex.brick, (D + WALL) / 2, shellH / 1.2));
        box(scene, W + WALL * 2, shellH, WALL, brickBack, 0, shellH / 2 - 0.3, -(D / 2 + WALL / 2));
        [-1, 1].forEach(function (s) {
            var wall = box(scene, WALL, shellH, D + WALL, brickSide, s * (W / 2 + WALL / 2), shellH / 2 - 0.3, -WALL / 2);
            wall.material = [brickSide, brickSide, brickSide, brickSide, M.cut, brickSide];
        });

        var slabMat = lam(0xffffff, withRepeat(tex.concrete, 3, 2));
        for (var i = 0; i <= 4; i++) {
            var y = i * P;
            box(scene, W, SLAB, D, slabMat, 0, y - SLAB / 2, 0);
            (function (index, yy) {
                var label = textTex(1024, 77, function (g, w, h) {
                    drawConcrete(g, w, h, '#221a17', 60 + index);
                    g.fillStyle = '#e9e1d0';
                    g.font = '800 54px ' + DISPLAY_FONT;
                    g.textBaseline = 'middle';
                    g.fillText(LABELS[index], 26, h / 2 + 3);
                    g.font = '500 22px "IBM Plex Mono", Consolas, monospace';
                    g.textAlign = 'right';
                    g.fillStyle = '#d9a441';
                    g.fillText('▼ +' + yy.toFixed(2).replace('.', ','), w - 24, h / 2 + 2);
                });
                plane(scene, W, SLAB, new T.MeshBasicMaterial({ map: label }), 0, yy - SLAB / 2, D / 2 + 0.006);
            })(i, y);
        }

        // Направляющие старого лифта, противовес и трос — вдоль задней стены
        var rails = new T.Group();
        scene.add(rails);
        [2.15, 2.8].forEach(function (x) { box(rails, 0.07, TOP + 0.4, 0.07, M.steel, x, TOP / 2 + 0.2, -D / 2 + 0.1); });
        for (var by = 0.6; by < TOP; by += 1.15) box(rails, 0.8, 0.05, 0.05, M.steel, 2.475, by, -D / 2 + 0.05);
        var weight = box(rails, 0.5, 1.1, 0.16, phong(0x3a2a22, 20), 2.475, 2, -D / 2 + 0.13);
        var cable = cyl(rails, 0.012, 0.012, 1, M.black, 2.475, 0, -D / 2 + 0.13, 6);

        // ----- Фасад здания по обе стороны от разреза -----

        function facade(side, seed) {
            var FW = 10, FH = TOP + 0.9;
            var px = 1024 / FW, py = 1024 / FH;
            var lit = [];
            var r = rng(seed);
            var cols = side < 0 ? [2.3, 5.2, 8.1] : [1.9, 4.8, 7.7];
            function windowPath(g, cx, y0, y1, half) {
                g.beginPath();
                g.moveTo((cx - half) * px, 1024 - y0 * py);
                g.lineTo((cx - half) * px, 1024 - (y1 - 0.35) * py);
                g.quadraticCurveTo(cx * px, 1024 - (y1 + 0.25) * py, (cx + half) * px, 1024 - (y1 - 0.35) * py);
                g.lineTo((cx + half) * px, 1024 - y0 * py);
                g.closePath();
            }
            var map = makeTex(1024, 1024, function (g, w, h) {
                drawBricks(g, w, h, { bw: 28, bh: 5.2, gap: 0.6, base: [120, 52, 36], mortar: '#2a1a15', seed: seed, specks: 5000 });
                g.fillStyle = '#3a332d';
                g.fillRect(0, h - 0.9 * py, w, 0.9 * py);
                for (var f = 0; f < 4; f++) {
                    g.fillStyle = '#7b7163';
                    g.fillRect(0, h - (f * P + 0.12) * py, w, 0.24 * py);
                    cols.forEach(function (cx) {
                        var y0 = f * P + 1.0, y1 = f * P + 2.75;
                        g.fillStyle = '#857a6a';
                        windowPath(g, cx, y0 - 0.12, y1 + 0.14, 0.78);
                        g.fill();
                        var on = r() < 0.3;
                        g.fillStyle = on ? '#c98a3e' : '#0b0e12';
                        windowPath(g, cx, y0, y1, 0.62);
                        g.fill();
                        if (on) lit.push([cx, y0, y1]);
                        g.fillStyle = '#2a241f';
                        g.fillRect((cx - 0.03) * px, h - y1 * py, 0.06 * px, (y1 - y0) * py);
                        g.fillRect((cx - 0.62) * px, h - (y0 + 1.1) * py, 1.24 * px, 0.05 * py);
                    });
                }
                g.fillStyle = '#7b7163';
                g.fillRect(0, 0, w, 0.5 * py);
            });
            var emissive = makeTex(1024, 1024, function (g, w, h) {
                g.fillStyle = '#000';
                g.fillRect(0, 0, w, h);
                lit.forEach(function (l) {
                    g.fillStyle = '#b06a26';
                    windowPath(g, l[0], l[1], l[2], 0.62);
                    g.fill();
                });
            });
            var mat = new T.MeshLambertMaterial({ map: map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 0.8 });
            plane(scene, FW, FH, mat, side * (W / 2 + WALL + FW / 2), FH / 2, D / 2);
            // Объём здания за фасадом, чтобы с крыши не было видно «картонку»
            box(scene, FW, FH, 12, bodyMat, side * (W / 2 + WALL + FW / 2), FH / 2, D / 2 - 6.01);
        }
        var bodyMat = lam(0x1c1613);
        facade(-1, 101);
        facade(1, 202);

        // Земля, тротуар, фонарь
        var ground = plane(scene, 260, 220, lam(0x1b1815), 0, -0.02, 10);
        ground.rotation.x = -Math.PI / 2;
        box(scene, 60, 0.14, 2.2, lam(0x38342f), 0, 0.05, D / 2 + 1.1 + 0.02).position.y = -0.03;
        cyl(scene, 0.05, 0.07, 4.2, M.steel, 6.2, 2.1, D / 2 + 1.7, 8);
        box(scene, 0.9, 0.05, 0.05, M.steel, 5.8, 4.2, D / 2 + 1.7);
        glow(scene, 0xffb46b, 2.4, 5.4, 4.12, D / 2 + 1.7, 0.8);
        var street = new T.PointLight(0xffb46b, 40, 16, 2);
        street.position.set(5.4, 4.0, D / 2 + 2.2);
        scene.add(street);

        // Город и звёзды на заднем плане
        var cityTex = makeTex(128, 256, function (g, w, h) {
            var r = rng(77);
            g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
            for (var yy = 6; yy < h - 6; yy += 12) {
                for (var xx = 6; xx < w - 6; xx += 10) {
                    if (r() < 0.16) { g.fillStyle = r() < 0.7 ? '#b98443' : '#6d86a8'; g.fillRect(xx, yy, 5, 6); }
                }
            }
        });
        var cityMat = new T.MeshLambertMaterial({ color: 0x08090c, emissiveMap: cityTex, emissive: 0xffffff, emissiveIntensity: 0.55, fog: false });
        var cr = rng(5);
        for (var c = 0; c < 18; c++) {
            var cw = 5 + cr() * 9, ch = 6 + cr() * 20;
            box(scene, cw, ch, 6, cityMat, -60 + c * 7 + cr() * 3, ch / 2, -26 - cr() * 22);
        }
        var starGeo = new T.BufferGeometry();
        var starPos = [];
        var sr = rng(9);
        for (var s = 0; s < 420; s++) starPos.push(-110 + sr() * 220, 4 + sr() * 70, -70 - sr() * 20);
        starGeo.setAttribute('position', new T.Float32BufferAttribute(starPos, 3));
        var starMat = new T.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false });
        scene.add(new T.Points(starGeo, starMat));

        // ----- Общие детали этажа: лестница и люк -----

        function floorGroup(index) {
            var g = new T.Group();
            g.position.y = index * P;
            scene.add(g);
            return g;
        }

        function stairs(g) {
            var run = 2.9, rise = H, len = Math.sqrt(run * run + rise * rise), ang = Math.atan2(rise, run);
            var st = new T.Group();
            st.position.set(-2.5, 0, 1.35);
            g.add(st);
            [-0.36, 0.36].forEach(function (x) {
                var b = box(st, 0.05, 0.16, len, M.steel, x, rise / 2, -run / 2);
                b.rotation.x = ang;
            });
            for (var n = 1; n <= 12; n++) {
                var k = n / 13;
                box(st, 0.7, 0.035, 0.2, M.steel, 0, k * rise, -k * run);
            }
            var rail = box(st, 0.03, 0.03, len, M.chrome, 0.38, rise / 2 + 0.85, -run / 2);
            rail.rotation.x = ang;
            box(g, 0.95, 0.02, 0.95, M.cut, -2.5, H - 0.008, -1.55);
        }

        // ----- 1 этаж: вход -----

        (function () {
            var g = floorGroup(0);
            var fl = plane(g, W, D, lam(0xffffff, withRepeat(tex.concreteDark, 3, 2)), 0, 0.004, 0);
            fl.rotation.x = -Math.PI / 2;
            stairs(g);

            // Дверь из коридора здания
            box(g, 1.16, 2.24, 0.06, M.black, 1.75, 1.12, -D / 2 + 0.03);
            box(g, 1.0, 2.1, 0.06, lam(0x2b3a34), 1.75, 1.05, -D / 2 + 0.06);
            box(g, 0.04, 0.18, 0.05, M.chrome, 2.12, 1.05, -D / 2 + 0.11);
            decal(g, textTex(256, 80, function (gg) {
                gg.fillStyle = '#16301f'; gg.fillRect(0, 0, 256, 80);
                gg.fillStyle = '#c9ffd8'; gg.font = '800 60px ' + DISPLAY_FONT;
                gg.textAlign = 'center'; gg.textBaseline = 'middle';
                gg.fillText('ВХОД', 128, 44);
            }), 0.56, 0.175, 1.75, 2.42, -D / 2 + 0.04);

            // Неон с названием
            var neon = decal(g, neonTex('BOMSE', '#ff5a2a', 512, 200, 150), 2.5, 0.98, -0.45, 2.0, -D / 2 + 0.03, true);
            updates.push(function (t, motion) {
                if (!motion) return;
                var dip = Math.sin(t * 13.7) * Math.sin(t * 3.1) > 0.93 ? 0.55 : 1;
                neon.material.opacity = dip;
            });
            decal(g, textTex(256, 128, function (gg) {
                gg.fillStyle = 'rgba(233,225,208,0.82)'; gg.font = '800 96px ' + DISPLAY_FONT;
                gg.textAlign = 'center'; gg.textBaseline = 'middle';
                gg.fillText('↑ 2 3 4', 128, 68);
            }), 0.9, 0.45, -2.15, 1.25, -D / 2 + 0.02);

            // Стойка
            box(g, 1.9, 1.0, 0.6, M.woodDark, -0.4, 0.5, -0.55);
            box(g, 2.0, 0.05, 0.7, M.wood, -0.4, 1.025, -0.55);
            box(g, 1.9, 0.5, 0.02, lam(0xffffff, withRepeat(tex.brickDark, 1, 0.5)), -0.4, 0.55, -0.245);
            box(g, 0.34, 0.24, 0.03, M.black, -0.9, 1.19, -0.6).rotation.x = -0.2;
            cyl(g, 0.02, 0.06, 0.3, M.chrome, 0.3, 1.2, -0.6, 8);
            cyl(g, 0.06, 0.13, 0.14, lam(0x2f5d4a), 0.3, 1.4, -0.6, 12);
            glow(g, 0xffc070, 0.7, 0.3, 1.34, -0.55, 0.6);
            blob(g, -0.4, -0.5, 2.8, 1.5);

            // Диван
            box(g, 1.7, 0.36, 0.72, M.leather, 1.55, 0.3, 1.05);
            box(g, 1.7, 0.5, 0.16, M.leather, 1.55, 0.66, 1.33).rotation.x = 0.12;
            [0.72, 2.38].forEach(function (x) { box(g, 0.12, 0.5, 0.72, M.leather, x, 0.4, 1.05); });
            blob(g, 1.55, 1.1, 2.4, 1.5);

            // Растение
            cyl(g, 0.2, 0.16, 0.36, lam(0x8a4a30), 2.62, 0.18, 0.1, 12);
            var leaf = lam(0x2e6a3d);
            var leafGeo = new T.ConeGeometry(1, 1, 5);
            for (var n = 0; n < 7; n++) {
                var l = new T.Mesh(leafGeo, leaf);
                l.position.set(2.62, 0.8, 0.1);
                l.scale.set(0.09, 0.95, 0.03);
                l.rotation.set(Math.sin(n * 0.9) * 0.5, n * 0.9, Math.cos(n * 0.9) * 0.5);
                g.add(l);
            }

            // Ковёр
            var rug = plane(g, 2.3, 1.3, lam(0x5a1b17), 0.2, 0.012, 1.1);
            rug.rotation.x = -Math.PI / 2;

            pendant(g, -0.4, -0.5, 0xffc27a);
            pendant(g, 1.55, 0.9, 0xffc27a);
            var light = new T.PointLight(0xffa550, 24, 8, 2);
            light.position.set(0.3, 2.3, 0.6);
            g.add(light);
        })();

        // ----- 2 этаж: парикмахерская -----

        (function () {
            var g = floorGroup(1);
            var fl = plane(g, W, D, new T.MeshPhongMaterial({ map: withRepeat(tex.checker, 6, 4.4), shininess: 40, specular: 0x333333 }), 0, 0.004, 0);
            fl.rotation.x = -Math.PI / 2;
            stairs(g);

            var mirrorTex = textTex(64, 128, function (gg) {
                var grd = gg.createLinearGradient(0, 0, 64, 128);
                grd.addColorStop(0, '#5d6b72'); grd.addColorStop(0.45, '#aab8bd'); grd.addColorStop(0.5, '#dfe8ea'); grd.addColorStop(0.56, '#93a2a8'); grd.addColorStop(1, '#3d484e');
                gg.fillStyle = grd; gg.fillRect(0, 0, 64, 128);
            });
            var bulbMat = basic(0xfff0cf);
            var bulbGeo = new T.SphereGeometry(0.045, 8, 6);
            var bottleColors = [0x2f6f8f, 0xc8a13a, 0x1c1c1c, 0xb7402a, 0xdcd6c8];

            function chair(x, z) {
                var ch = new T.Group();
                ch.position.set(x, 0, z);
                g.add(ch);
                cyl(ch, 0.33, 0.35, 0.04, M.chrome, 0, 0.02, 0, 20);
                cyl(ch, 0.06, 0.07, 0.44, M.chrome, 0, 0.25, 0, 10);
                box(ch, 0.6, 0.14, 0.58, M.leather, 0, 0.55, 0);
                box(ch, 0.56, 0.64, 0.12, M.leather, 0, 0.97, 0.27).rotation.x = 0.1;
                box(ch, 0.26, 0.17, 0.1, M.leather, 0, 1.4, 0.33);
                [-0.33, 0.33].forEach(function (ax) {
                    box(ch, 0.07, 0.06, 0.5, M.chrome, ax, 0.76, 0.02);
                    box(ch, 0.05, 0.16, 0.05, M.chrome, ax, 0.66, -0.2);
                });
                box(ch, 0.42, 0.04, 0.2, M.chrome, 0, 0.26, -0.46).rotation.x = 0.3;
                box(ch, 0.05, 0.05, 0.3, M.chrome, 0, 0.3, -0.3);
                blob(g, x, z, 1.5, 1.5);
            }

            [-0.7, 1.45].forEach(function (x, n) {
                box(g, 1.04, 1.56, 0.06, M.black, x, 1.72, -D / 2 + 0.03);
                plane(g, 0.9, 1.42, new T.MeshBasicMaterial({ map: mirrorTex }), x, 1.72, -D / 2 + 0.065);
                for (var b = 0; b < 5; b++) {
                    [-0.58, 0.58].forEach(function (dx) {
                        var bulb = new T.Mesh(bulbGeo, bulbMat);
                        bulb.position.set(x + dx, 1.1 + b * 0.31, -D / 2 + 0.09);
                        g.add(bulb);
                    });
                }
                glow(g, 0xfff0cf, 2.6, x, 1.75, -D / 2 + 0.2, 0.32);
                box(g, 1.2, 0.05, 0.3, M.wood, x, 0.86, -D / 2 + 0.16);
                for (var k = 0; k < 5; k++) {
                    cyl(g, 0.03, 0.04, 0.15 + (k % 3) * 0.04, lam(bottleColors[(k + n) % 5]), x - 0.42 + k * 0.2, 0.96, -D / 2 + 0.16, 8);
                }
                chair(x, -0.95);
                pendant(g, x, -0.6, 0xfff1d8);
            });

            // Часы между зеркалами
            var clock = decal(g, textTex(128, 128, function (gg) {
                gg.fillStyle = '#ece5d6'; gg.beginPath(); gg.arc(64, 64, 60, 0, 7); gg.fill();
                gg.strokeStyle = '#161412'; gg.lineWidth = 6; gg.stroke();
                gg.lineWidth = 4;
                for (var n = 0; n < 12; n++) {
                    var a = n * Math.PI / 6;
                    gg.beginPath(); gg.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46); gg.lineTo(64 + Math.cos(a) * 53, 64 + Math.sin(a) * 53); gg.stroke();
                }
                gg.lineWidth = 5; gg.beginPath(); gg.moveTo(64, 64); gg.lineTo(64 + 22, 64 - 20); gg.stroke();
                gg.lineWidth = 3; gg.beginPath(); gg.moveTo(64, 64); gg.lineTo(64 - 8, 64 - 42); gg.stroke();
            }), 0.42, 0.42, 0.375, 2.5, -D / 2 + 0.02);
            clock.material.toneMapped = true;

            // Тележка с инструментом
            box(g, 0.42, 0.78, 0.4, M.black, 0.375, 0.42, -1.55);
            box(g, 0.46, 0.03, 0.44, M.chrome, 0.375, 0.82, -1.55);
            cyl(g, 0.05, 0.05, 0.2, lam(0x2f6f8f), 0.3, 0.93, -1.5, 8);

            // Мойка
            box(g, 0.7, 0.86, 0.6, M.white, 2.5, 0.43, 0.2);
            box(g, 0.56, 0.06, 0.46, M.black, 2.5, 0.87, 0.2);
            cyl(g, 0.015, 0.015, 0.3, M.chrome, 2.72, 1.02, 0.2, 6);
            blob(g, 2.5, 0.25, 1.3, 1.2);

            // Вращающийся столбик у правой стены
            var poleTex = makeTex(64, 64, function (gg) {
                gg.fillStyle = '#f2ede0'; gg.fillRect(0, 0, 64, 64);
                [['#c8321f', 0], ['#27518f', 32]].forEach(function (cfg) {
                    gg.fillStyle = cfg[0];
                    for (var k = -1; k < 2; k++) {
                        gg.beginPath();
                        gg.moveTo(cfg[1] + k * 64, 64); gg.lineTo(cfg[1] + 16 + k * 64, 64);
                        gg.lineTo(cfg[1] + 80 + k * 64, 0); gg.lineTo(cfg[1] + 64 + k * 64, 0);
                        gg.fill();
                    }
                });
            }, 1, 2);
            var pole = cyl(g, 0.085, 0.085, 0.62, new T.MeshBasicMaterial({ map: poleTex }), W / 2 - 0.16, 1.95, 1.2, 18);
            cyl(g, 0.1, 0.1, 0.07, M.chrome, W / 2 - 0.16, 2.3, 1.2, 14);
            cyl(g, 0.1, 0.1, 0.07, M.chrome, W / 2 - 0.16, 1.6, 1.2, 14);
            glow(g, 0xffffff, 0.9, W / 2 - 0.2, 1.95, 1.25, 0.25);
            updates.push(function (t, motion) { if (motion) poleTex.offset.y = -t * 0.35; });

            var light = new T.PointLight(0xfff1d8, 42, 8, 2);
            light.position.set(0.4, 2.45, 0.5);
            g.add(light);
        })();

        // ----- 3 этаж: тату -----

        (function () {
            var g = floorGroup(2);
            var fl = plane(g, W, D, new T.MeshPhongMaterial({ color: 0x1a181c, shininess: 70, specular: 0x444444 }), 0, 0.004, 0);
            fl.rotation.x = -Math.PI / 2;
            stairs(g);
            plane(g, W, H, lam(0xffffff, withRepeat(tex.brickDark, 3, 2.5)), 0, H / 2, -D / 2 + 0.008);

            // Флеш-листы на стене
            var icons = [
                function (c) { c.beginPath(); for (var n = 0; n < 10; n++) { var a = n * Math.PI / 5 - Math.PI / 2, rr = n % 2 ? 14 : 34; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.stroke(); },
                function (c) { c.beginPath(); c.moveTo(0, 30); c.bezierCurveTo(-48, -6, -22, -44, 0, -16); c.bezierCurveTo(22, -44, 48, -6, 0, 30); c.stroke(); c.beginPath(); c.moveTo(-34, 10); c.lineTo(34, -22); c.stroke(); },
                function (c) { c.beginPath(); c.moveTo(8, -38); c.lineTo(-16, 4); c.lineTo(2, 4); c.lineTo(-8, 38); c.lineTo(18, -8); c.lineTo(0, -8); c.closePath(); c.stroke(); },
                function (c) { c.beginPath(); c.ellipse(0, 0, 36, 18, 0, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 10, 0, 7); c.fill(); for (var n = -2; n <= 2; n++) { c.beginPath(); c.moveTo(n * 12, -22); c.lineTo(n * 15, -34); c.stroke(); } },
                function (c) { c.beginPath(); c.moveTo(0, -40); c.lineTo(8, 14); c.lineTo(-8, 14); c.closePath(); c.stroke(); c.strokeRect(-18, 14, 36, 5); c.strokeRect(-4, 19, 8, 20); },
                function (c) { c.beginPath(); for (var a = 0; a < 15; a += 0.2) c.lineTo(Math.cos(a) * a * 2.3, Math.sin(a) * a * 2.3); c.stroke(); },
                function (c) { c.beginPath(); c.moveTo(0, 36); c.bezierCurveTo(-36, 20, -20, -10, -6, -22); c.bezierCurveTo(-8, -4, 6, -6, 2, -40); c.bezierCurveTo(30, -12, 34, 20, 0, 36); c.stroke(); },
                function (c) { c.beginPath(); c.arc(0, -6, 26, Math.PI, 0); c.lineTo(26, 14); c.lineTo(14, 14); c.lineTo(14, 30); c.lineTo(-14, 30); c.lineTo(-14, 14); c.lineTo(-26, 14); c.closePath(); c.stroke(); c.beginPath(); c.arc(-10, -4, 6, 0, 7); c.arc(10, -4, 6, 0, 7); c.fill(); }
            ];
            icons.forEach(function (draw, n) {
                var sheet = textTex(128, 170, function (c) {
                    c.fillStyle = n % 3 === 1 ? '#ddd0b4' : '#e9dfc8';
                    c.fillRect(0, 0, 128, 170);
                    c.translate(64, 85);
                    c.lineWidth = 4; c.lineJoin = 'round';
                    c.strokeStyle = c.fillStyle = n % 2 ? '#a3261a' : '#151210';
                    draw(c);
                });
                var x = 0.2 + (n % 4) * 0.62, y = n < 4 ? 2.1 : 1.36;
                box(g, 0.47, 0.61, 0.02, M.black, x, y, -D / 2 + 0.025);
                plane(g, 0.42, 0.56, new T.MeshLambertMaterial({ map: sheet }), x, y, -D / 2 + 0.04).rotation.z = (n % 3 - 1) * 0.015;
            });

            decal(g, neonTex('ТАТУ', '#ff2a55', 384, 200, 150), 1.5, 0.78, -1.3, 2.25, -D / 2 + 0.04, true);

            // Кушетка
            box(g, 1.9, 0.12, 0.66, M.leatherBlack, 0.45, 0.66, -0.25);
            box(g, 0.5, 0.1, 0.62, M.leatherBlack, 1.55, 0.74, -0.25).rotation.z = 0.32;
            [-0.3, 1.1].forEach(function (x) { box(g, 0.1, 0.6, 0.5, M.chrome, x, 0.3, -0.25); });
            box(g, 1.5, 0.05, 0.08, M.chrome, 0.4, 0.06, -0.25);
            blob(g, 0.5, -0.2, 2.8, 1.5);

            // Табурет мастера
            cyl(g, 0.19, 0.19, 0.08, M.leatherBlack, -0.2, 0.52, 0.75, 16);
            cyl(g, 0.03, 0.03, 0.44, M.chrome, -0.2, 0.27, 0.75, 8);
            cyl(g, 0.26, 0.26, 0.03, M.chrome, -0.2, 0.04, 0.75, 5);
            blob(g, -0.2, 0.75, 0.9, 0.9);

            // Кольцевая лампа
            cyl(g, 0.018, 0.018, 1.75, M.black, 1.75, 0.875, 0.55, 6);
            cyl(g, 0.22, 0.22, 0.03, M.black, 1.75, 0.02, 0.55, 5);
            var ring = new T.Mesh(new T.TorusGeometry(0.27, 0.028, 8, 28), basic(0xffffff));
            ring.position.set(1.72, 1.82, 0.55);
            ring.rotation.set(0.2, -0.9, 0);
            g.add(ring);
            glow(g, 0xfff3e6, 1.5, 1.72, 1.82, 0.6, 0.5);
            var ringLight = new T.PointLight(0xfff0e0, 9, 4, 2);
            ringLight.position.set(1.4, 1.7, 0.4);
            g.add(ringLight);

            // Красная тележка с красками
            box(g, 0.52, 0.8, 0.42, phong(0x9a1f1c, 40), -1.25, 0.44, -0.75);
            [0.3, 0.52, 0.74].forEach(function (yy) { box(g, 0.44, 0.02, 0.01, M.chrome, -1.25, yy, -0.535); });
            [0x111111, 0xc8321f, 0x27518f, 0xd9a441, 0x2e6a3d].forEach(function (col, n) {
                cyl(g, 0.022, 0.028, 0.09, lam(col), -1.43 + n * 0.09, 0.89, -0.72, 8);
            });
            blob(g, -1.25, -0.7, 1.0, 0.9);

            // Шкаф и бумбокс у правой стены
            box(g, 0.5, 0.92, 1.3, M.steel, 2.7, 0.46, -1.4);
            box(g, 0.2, 0.26, 0.56, M.black, 2.68, 1.05, -1.4);
            [-1.56, -1.24].forEach(function (z) {
                var sp = cyl(g, 0.09, 0.09, 0.02, M.chrome, 2.57, 1.05, z, 14);
                sp.rotation.z = Math.PI / 2;
            });

            var light = new T.PointLight(0xff2d42, 46, 8, 2);
            light.position.set(-0.6, 2.5, 0.4);
            g.add(light);
            glow(g, 0xff2d42, 3.4, -1.3, 2.25, -D / 2 + 0.3, 0.28);
        })();

        // ----- 4 этаж: мастерская -----

        (function () {
            var g = floorGroup(3);
            var fl = plane(g, W, D, lam(0xffffff, withRepeat(tex.wood, 3, 4)), 0, 0.004, 0);
            fl.rotation.x = -Math.PI / 2;
            box(g, 0.95, 0.02, 0.95, M.cut, -2.5, H - 0.008, -1.55);
            // Приставная лестница на крышу
            [-2.75, -2.3].forEach(function (x) { box(g, 0.04, H, 0.04, M.steel, x, H / 2, -1.9); });
            for (var n = 1; n < 10; n++) box(g, 0.45, 0.03, 0.03, M.steel, -2.525, n * 0.3, -1.9);

            // Граффити на задней стене
            var graffiti = textTex(1024, 512, function (c, w, h) {
                var r = rng(314);
                drawBricks(c, w, h, { bw: 86, bh: 26, gap: 2, base: [150, 70, 48], seed: 51 });
                var colors = ['#c9f03a', '#ff4f8b', '#35c6ff', '#ff9a1f', '#f4eee0'];
                for (var n = 0; n < 7; n++) {
                    var grd = c.createRadialGradient(0, 0, 0, 0, 0, 1);
                    var col = colors[n % colors.length];
                    grd.addColorStop(0, col); grd.addColorStop(0.7, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
                    c.save();
                    c.translate(120 + r() * 800, 120 + r() * 300);
                    c.scale(90 + r() * 110, 60 + r() * 90);
                    c.globalAlpha = 0.55;
                    c.fillStyle = grd; c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill();
                    c.restore();
                }
                c.globalAlpha = 1;
                c.save();
                c.translate(w / 2 + 40, h / 2 + 30);
                c.transform(1, -0.08, -0.22, 1, 0, 0);
                c.font = '800 330px ' + DISPLAY_FONT;
                c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
                c.fillStyle = '#0d0b0b'; c.fillText('BOMSE', 16, 18);
                c.lineWidth = 34; c.strokeStyle = '#0d0b0b'; c.strokeText('BOMSE', 0, 0);
                var fill = c.createLinearGradient(0, -150, 0, 150);
                fill.addColorStop(0, '#f6ff7a'); fill.addColorStop(0.5, '#c9f03a'); fill.addColorStop(1, '#3fbf6a');
                c.fillStyle = fill; c.fillText('BOMSE', 0, 0);
                c.lineWidth = 5; c.strokeStyle = '#ffffff'; c.strokeText('BOMSE', -5, -6);
                c.restore();
                c.strokeStyle = '#0d0b0b'; c.lineCap = 'round';
                for (var d = 0; d < 26; d++) {
                    var x = 150 + r() * 760, y = 300 + r() * 80;
                    c.lineWidth = 3 + r() * 4;
                    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 30 + r() * 120); c.stroke();
                }
                c.lineWidth = 6; c.strokeStyle = '#f4eee0';
                for (var t2 = 0; t2 < 4; t2++) {
                    c.beginPath();
                    var sx = 40 + r() * 880, sy = 40 + r() * 80 + (t2 % 2) * 360;
                    c.moveTo(sx, sy);
                    for (var q = 0; q < 6; q++) c.quadraticCurveTo(sx + q * 22 + r() * 30, sy - 40 + r() * 80, sx + (q + 1) * 22, sy + (r() - 0.5) * 30);
                    c.stroke();
                }
                for (var sp = 0; sp < 500; sp++) {
                    c.fillStyle = colors[Math.floor(r() * colors.length)];
                    c.globalAlpha = 0.5;
                    c.fillRect(r() * w, r() * h, 2, 2);
                }
            });
            plane(g, W, H, new T.MeshLambertMaterial({ map: graffiti }), 0, H / 2, -D / 2 + 0.008);

            // Световой фонарь и столб света
            plane(g, 2.2, 1.4, basic(0xdfe9ff), 0.5, H - 0.006, 0.1).rotation.x = Math.PI / 2;
            var shaftTex = textTex(8, 128, function (c) {
                var grd = c.createLinearGradient(0, 0, 0, 128);
                grd.addColorStop(0, 'rgba(210,225,255,0.55)'); grd.addColorStop(1, 'rgba(210,225,255,0)');
                c.fillStyle = grd; c.fillRect(0, 0, 8, 128);
            });
            var beamMat = new T.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, opacity: 0.5, toneMapped: false });
            plane(g, 2.2, H, beamMat, 0.5, H / 2, 0.1);
            plane(g, 1.4, H, beamMat, 0.5, H / 2, 0.1).rotation.y = Math.PI / 2;

            // Печатный стол
            box(g, 2.4, 0.06, 1.0, M.wood, 0.5, 0.9, -0.4);
            [[-0.6, -0.8], [1.6, -0.8], [-0.6, 0], [1.6, 0]].forEach(function (pp) { box(g, 0.06, 0.88, 0.06, M.steel, pp[0], 0.44, pp[1]); });
            box(g, 2.3, 0.04, 0.9, M.woodDark, 0.5, 0.3, -0.4);
            box(g, 0.9, 0.012, 0.6, lam(0x2f6f4f), 0.1, 0.937, -0.4);
            box(g, 0.62, 0.04, 0.8, M.woodDark, 1.2, 0.95, -0.4);
            box(g, 0.5, 0.012, 0.68, lam(0xe2572f), 1.2, 0.975, -0.4);
            box(g, 0.4, 0.07, 0.05, M.woodDark, 1.2, 1.01, -0.2);
            [0xc9f03a, 0xff4f8b, 0x35c6ff, 0xf4eee0].forEach(function (col, n) {
                cyl(g, 0.06, 0.06, 0.13, lam(col), -0.45 + n * 0.16, 0.995, -0.72, 10);
            });
            [0xe6dfd0, 0x151315, 0xe6dfd0, 0xe2572f].forEach(function (col, n) {
                box(g, 0.44, 0.035, 0.34, lam(col), 0.2, 0.32 + 0.02 + n * 0.037, -0.4);
            });
            blob(g, 0.5, -0.35, 3.3, 1.9);

            // Карусель для шелкографии
            var car = new T.Group();
            car.position.set(2.0, 0, 1.0);
            g.add(car);
            cyl(g, 0.05, 0.05, 1.0, M.steel, 2.0, 0.5, 1.0, 8);
            cyl(g, 0.3, 0.3, 0.03, M.steel, 2.0, 0.02, 1.0, 6);
            [0xe6dfd0, 0x151315, 0xe2572f, 0xc9f03a].forEach(function (col, n) {
                var arm = new T.Group();
                arm.rotation.y = n * Math.PI / 2;
                car.add(arm);
                box(arm, 0.62, 0.04, 0.08, M.steel, 0.31, 1.0, 0);
                box(arm, 0.36, 0.03, 0.42, M.woodDark, 0.6, 1.035, 0);
                box(arm, 0.3, 0.012, 0.36, lam(col), 0.6, 1.058, 0);
            });
            blob(g, 2.0, 1.0, 1.8, 1.8);
            updates.push(function (t, motion) { if (motion) car.rotation.y = t * 0.25; });

            // Полки с баллончиками
            var canColors = [0xc9f03a, 0xff4f8b, 0x35c6ff, 0xff9a1f, 0xf4eee0, 0x8b3dff, 0xe2572f, 0x111111, 0x2e6a3d, 0xffd400];
            [1.3, 1.78].forEach(function (yy, row) {
                box(g, 0.24, 0.04, 1.7, M.woodDark, W / 2 - 0.13, yy, -1.2);
                for (var k = 0; k < 11; k++) {
                    var z = -1.95 + k * 0.15;
                    cyl(g, 0.034, 0.034, 0.19, lam(canColors[(k + row * 3) % 10]), W / 2 - 0.14, yy + 0.115, z, 8);
                    cyl(g, 0.02, 0.03, 0.04, M.white, W / 2 - 0.14, yy + 0.23, z, 8);
                }
            });

            // Холсты у стены
            var paintTex = function (seed, bg) {
                return textTex(128, 160, function (c, w, h) {
                    var r = rng(seed);
                    c.fillStyle = bg; c.fillRect(0, 0, w, h);
                    for (var k = 0; k < 9; k++) {
                        c.fillStyle = ['#e2572f', '#111', '#c9f03a', '#35c6ff', '#f4eee0', '#ff4f8b'][Math.floor(r() * 6)];
                        c.beginPath();
                        c.ellipse(r() * w, r() * h, 10 + r() * 34, 8 + r() * 30, r() * 3, 0, 7);
                        c.fill();
                    }
                    c.strokeStyle = '#111'; c.lineWidth = 5; c.beginPath();
                    c.moveTo(r() * w, r() * h);
                    for (var q = 0; q < 5; q++) c.lineTo(r() * w, r() * h);
                    c.stroke();
                });
            };
            [[-1.75, 1.25, 1.5, 61, '#ead9b8'], [-1.0, 0.9, 1.1, 62, '#20262e'], [-0.55, 0.62, 0.78, 63, '#d9d2c2']].forEach(function (cv, n) {
                var m = box(g, cv[1], cv[2], 0.04, [M.white, M.white, M.white, M.white, new T.MeshLambertMaterial({ map: paintTex(cv[3], cv[4]) }), M.white], cv[0], cv[2] / 2 + 0.02, -D / 2 + 0.2 + n * 0.09);
                m.rotation.x = -0.1;
                m.rotation.z = (n - 1) * 0.02;
            });

            // Вешалка с футболками
            box(g, 0.03, 1.6, 0.03, M.chrome, -1.9, 0.8, 1.2);
            box(g, 0.03, 1.6, 0.03, M.chrome, -0.5, 0.8, 1.2);
            box(g, 1.43, 0.03, 0.03, M.chrome, -1.2, 1.6, 1.2);
            [0x151315, 0xe6dfd0, 0xe2572f, 0x151315, 0xc9f03a, 0xe6dfd0].forEach(function (col, n) {
                var sh = new T.Group();
                sh.position.set(-1.75 + n * 0.22, 1.56, 1.2);
                sh.rotation.y = 1.15;
                g.add(sh);
                box(sh, 0.44, 0.56, 0.02, lam(col), 0, -0.34, 0);
                box(sh, 0.68, 0.16, 0.02, lam(col), 0, -0.13, 0);
            });
            blob(g, -1.2, 1.2, 1.9, 0.9);

            // Вёдра с краской
            [[1.0, 0.75, 0xf4eee0], [0.7, 1.05, 0xe2572f], [1.25, 1.3, 0x35c6ff]].forEach(function (b) {
                cyl(g, 0.13, 0.11, 0.24, M.white, b[0], 0.12, b[1], 12);
                cyl(g, 0.115, 0.115, 0.01, lam(b[2]), b[0], 0.243, b[1], 12);
            });

            var light = new T.PointLight(0xdbe6ff, 46, 8.5, 2);
            light.position.set(0.5, 2.6, 0.4);
            g.add(light);
        })();

        // ----- Крыша: лебёдка, шкив, вывеска -----

        var wheel;
        (function () {
            var g = floorGroup(4);
            var fl = plane(g, W, D, lam(0xffffff, withRepeat(tex.concreteDark, 3, 2)), 0, 0.004, 0);
            fl.rotation.x = -Math.PI / 2;
            // Люк с лестницы
            box(g, 1.0, 0.14, 1.0, M.steel, -2.5, 0.07, -1.55);
            box(g, 0.94, 0.03, 0.94, phong(0x4a4d52, 60), -2.5, 0.5, -1.98).rotation.x = -1.15;

            // Фонарь над мастерской
            box(g, 2.3, 0.3, 1.5, M.steel, 0.5, 0.15, 0.1);
            var glass = box(g, 2.1, 0.06, 1.3, basic(0xbcd0ff), 0.5, 0.32, 0.1);
            glass.material.transparent = true;
            glass.material.opacity = 0.85;
            glow(g, 0xbcd0ff, 3.2, 0.5, 0.5, 0.1, 0.3);

            // Шкив на раме
            wheel = new T.Group();
            wheel.position.set(1.775, 1.7, -D / 2 + 0.13);
            g.add(wheel);
            var rim = new T.Mesh(new T.TorusGeometry(0.7, 0.06, 8, 36), M.steel);
            wheel.add(rim);
            for (var n = 0; n < 3; n++) box(wheel, 1.34, 0.07, 0.05, M.steel, 0, 0, 0).rotation.z = n * Math.PI / 3;
            var hub = cyl(wheel, 0.12, 0.12, 0.2, M.chrome, 0, 0, 0, 12);
            hub.rotation.x = Math.PI / 2;
            [[-0.75, 0.42], [0.75, -0.42]].forEach(function (leg) {
                var b = box(g, 0.09, 1.9, 0.09, M.steel, 1.775 + leg[0], 0.86, -D / 2 + 0.36);
                b.rotation.z = leg[1];
            });
            box(g, 0.1, 0.1, 0.5, M.steel, 1.775, 1.7, -D / 2 + 0.3);
            // Лебёдка
            var drum = cyl(g, 0.3, 0.3, 0.7, phong(0x5b3a2a, 30), 1.075, 0.42, -D / 2 + 0.55, 16);
            drum.rotation.x = Math.PI / 2;
            box(g, 0.9, 0.12, 1.1, M.steel, 1.075, 0.06, -D / 2 + 0.6);
            box(g, 0.5, 0.45, 0.5, phong(0x2f4a3f, 30), 0.3, 0.3, -D / 2 + 0.6);
            cyl(g, 0.012, 0.012, 1.3, M.black, 1.075, 1.05, -D / 2 + 0.13, 6);

            // Вентиляция и антенна
            cyl(g, 0.16, 0.16, 0.9, M.chrome, -1.6, 0.45, -1.6, 12);
            cyl(g, 0.24, 0.24, 0.08, M.chrome, -1.6, 0.94, -1.6, 12);
            cyl(g, 0.015, 0.015, 2.6, M.steel, 2.75, 1.3, 1.6, 6);

            // Вывеска
            var signTex = neonTex('BOMSE', '#ff5a2a', 1024, 360, 300);
            var sign = decal(g, signTex, 5.2, 1.83, -0.55, 1.75, 1.5, true);
            sign.material.side = T.DoubleSide;
            [-2.9, -0.55, 1.8].forEach(function (x) {
                box(g, 0.06, 2.5, 0.06, M.steel, x, 1.25, 1.38);
                box(g, 0.05, 1.7, 0.05, M.steel, x, 0.72, 0.9).rotation.x = 0.62;
            });
            box(g, 5.0, 0.05, 0.05, M.steel, -0.55, 0.9, 1.38);
            box(g, 5.0, 0.05, 0.05, M.steel, -0.55, 2.5, 1.38);
            var signLight = new T.PointLight(0xff5a2a, 40, 12, 2);
            signLight.position.set(-0.5, 1.9, 2.4);
            g.add(signLight);
            glow(g, 0xff5a2a, 7, -0.55, 1.75, 1.3, 0.22);
            updates.push(function (t, motion) {
                if (!motion) return;
                var dip = Math.sin(t * 9.3) * Math.sin(t * 2.3) > 0.95 ? 0.6 : 1;
                sign.material.opacity = dip;
            });
        })();

        // ----- Пыль в шахте -----

        var dustCount = 220;
        var dustPos = new Float32Array(dustCount * 3);
        var dr = rng(1234);
        for (var d = 0; d < dustCount; d++) {
            dustPos[d * 3] = -W / 2 + dr() * W;
            dustPos[d * 3 + 1] = dr() * TOP;
            dustPos[d * 3 + 2] = -D / 2 + dr() * (D + 1.5);
        }
        var dustGeo = new T.BufferGeometry();
        dustGeo.setAttribute('position', new T.BufferAttribute(dustPos, 3));
        var dust = new T.Points(dustGeo, new T.PointsMaterial({
            map: tex.glow, color: 0xffe2b8, size: 0.05, transparent: true, opacity: 0.45,
            blending: T.AdditiveBlending, depthWrite: false
        }));
        scene.add(dust);
        var lastT = 0;
        updates.push(function (t, motion) {
            var dt = Math.min(0.05, t - lastT);
            lastT = t;
            if (!motion) return;
            for (var n = 0; n < dustCount; n++) {
                var yy = dustPos[n * 3 + 1] + dt * (0.04 + (n % 7) * 0.012);
                dustPos[n * 3 + 1] = yy > TOP ? 0 : yy;
                dustPos[n * 3] += Math.sin(t * 0.4 + n) * dt * 0.02;
            }
            dustGeo.attributes.position.needsUpdate = true;
        });

        return {
            updates: updates,
            starMat: starMat,
            setLift: function (ty) {
                var cy = clamp(TOP + 0.4 - ty, 0.9, TOP - 0.9);
                weight.position.y = cy;
                var top = TOP + 1.7;
                cable.scale.y = top - cy - 0.55;
                cable.position.y = (top + cy + 0.55) / 2;
                wheel.rotation.z = -ty / 0.7;
            }
        };
    }

    // ---------- Камера ----------

    function stopFrame(i, p, mobile) {
        var k = mobile ? 0.5 : 1;
        if (i <= 0) return { ty: TOP / 2 + 1.1, bw: 8.5, bh: TOP + 4.4, elev: 0.1, swing: (-0.24 + p * 0.08) * k };
        if (i >= 5) return { ty: TOP + 1.35, bw: 8.6, bh: 4.9, elev: 0.2, swing: (0.2 - p * 0.14) * k };
        var dir = i % 2 ? 1 : -1;
        // На первом этаже целимся чуть выше, чтобы под комнатой не оставалось пустой земли
        return { ty: (i - 1) * P + (i === 1 ? 2.0 : 1.5), bw: 7.3, bh: 3.9, elev: 0.1, swing: dir * (p - 0.5) * 0.22 * k };
    }

    function framing(i, mobile) {
        if (mobile) return i <= 0 ? { cx: 0.5, cy: 0.25, aw: 0.92, ah: 0.38 } : { cx: 0.5, cy: 0.225, aw: 0.95, ah: 0.34 };
        return i <= 0 ? { cx: 0.7, cy: 0.5, aw: 0.46, ah: 0.84 } : { cx: 0.65, cy: 0.5, aw: 0.56, ah: 0.68 };
    }

    function mix(a, b, k) {
        var out = {};
        for (var key in a) out[key] = lerp(a[key], b[key], k);
        return out;
    }

    // ---------- Запуск ----------

    function init(canvas) {
        var renderer;
        try {
            renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
        } catch (e) {
            return null;
        }
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;

        var scene = new T.Scene();
        var bgHero = new T.Color(0x0b1019), bgIn = new T.Color(0x0f0d0c), bgRoof = new T.Color(0x0c1424);
        scene.background = bgHero.clone();
        scene.fog = new T.Fog(scene.background.getHex(), 40, 150);

        scene.add(new T.HemisphereLight(0x53607c, 0x2a1c14, 1.5));
        var moon = new T.DirectionalLight(0x8ea4d6, 1.3);
        moon.position.set(-6, 12, 14);
        scene.add(moon);

        var camera = new T.PerspectiveCamera(FOV, 1, 0.5, 260);
        var world = build(scene);

        var mqMobile = window.matchMedia('(max-width: 860px)');
        var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
        var target = { t: 0, pA: 0, pB: 0 };
        var cur = { t: 0, pA: 0, pB: 0 };
        var pointer = { x: 0, y: 0, cx: 0, cy: 0 };
        var size = { w: 1, h: 1 };
        var dirty = true;
        var tanV = Math.tan(FOV * Math.PI / 360);

        function resize() {
            var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
            size.w = w; size.h = h;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mqMobile.matches ? 1.5 : 1.75));
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            dirty = true;
        }

        function place() {
            var mobile = mqMobile.matches;
            var i0 = clamp(Math.floor(cur.t), 0, 4);
            var f = smoother(cur.t - i0);
            var A = stopFrame(i0, cur.pA, mobile), B = stopFrame(i0 + 1, cur.pB, mobile);
            var fr = mix(A, B, f);
            var fm = mix(framing(i0, mobile), framing(i0 + 1, mobile), f);
            var dist = Math.max(fr.bh / 2 / tanV / fm.ah, fr.bw / 2 / (tanV * camera.aspect) / fm.aw) + D / 2;

            camera.position.set(dist * (fr.swing + pointer.cx * 0.035), fr.ty + dist * (fr.elev - pointer.cy * 0.02), dist);
            camera.lookAt(0, fr.ty, 0);
            camera.setViewOffset(size.w, size.h, (0.5 - fm.cx) * size.w, (0.5 - fm.cy) * size.h, size.w, size.h);

            // Небо: ночное снаружи, тёплая темнота внутри
            var out = clamp(1 - cur.t, 0, 1), roof = clamp(cur.t - 4, 0, 1);
            scene.background.copy(bgIn).lerp(bgHero, out).lerp(bgRoof, roof);
            scene.fog.color.copy(scene.background);
            world.starMat.opacity = 0.85 * Math.max(out, roof);
            world.setLift(fr.ty);
        }

        var clock = new T.Clock();

        function frame() {
            requestAnimationFrame(frame);
            var dt = Math.min(0.05, clock.getDelta());
            var motion = !mqReduce.matches;
            var k = motion ? 1 - Math.exp(-dt * 6.5) : 1;
            var moved = false;
            ['t', 'pA', 'pB'].forEach(function (key) {
                var diff = target[key] - cur[key];
                if (Math.abs(diff) > 0.0004) { cur[key] += diff * k; moved = true; } else if (diff !== 0) { cur[key] = target[key]; moved = true; }
            });
            if (motion) {
                pointer.cx += (pointer.x - pointer.cx) * k * 0.6;
                pointer.cy += (pointer.y - pointer.cy) * k * 0.6;
            }
            if (!motion && !moved && !dirty) return;
            dirty = false;
            var t = clock.elapsedTime;
            for (var n = 0; n < world.updates.length; n++) world.updates[n](t, motion);
            place();
            renderer.render(scene, camera);
        }

        window.addEventListener('resize', resize);
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            window.addEventListener('pointermove', function (e) {
                pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
                pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
            }, { passive: true });
        }

        resize();
        frame();

        return {
            setState: function (s) {
                target.t = clamp(s.t, 0, 5);
                target.pA = clamp(s.pA, 0, 1);
                target.pB = clamp(s.pB, 0, 1);
            },
            // Мгновенный переход без сглаживания (для проверки и скриншотов)
            jump: function (s) {
                this.setState(s);
                cur.t = target.t; cur.pA = target.pA; cur.pB = target.pB;
                dirty = true;
            }
        };
    }

    window.BomseScene = { init: init };
})();
