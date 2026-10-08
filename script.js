/* ==========================================================================
           1. ADVANCED PHYSICS & STABILITY CONFIGURATION
           ========================================================================== */
        const PARTICLE_COUNT = 18000;
        const PARTICLE_SIZE = 0.38;
        const CAMERA_FOV = 60;
        const SHAPE_SCALE = 14;

        const PHYSICS_CONFIG = {
            // Morph & Fast Reset (Deterministic, rapid return)
            normalMorphSpeed: 0.055,
            resetMorphSpeed: 0.22,             // Significantly faster return
            springStrength: 0.048,             // Controlled spring without oscillation
            normalDamping: 0.915,              // Base velocity retention
            resetDamping: 0.70,                // Fast velocity dissipation on reset
            
            // Safety Limits
            maxParticleSpeed: 2.2,             // Hard clamp on particle speed to prevent runaway
            maxParticleRadius: 75.0,           // Emergency boundary envelope
            maxHandSpeed: 2.6,                 // MediaPipe sudden jump rejection clamp
            forceLimit: 1.6,                   // Max combined force allowed on any particle per frame
            
            // Hand Tracking Smoothing & Deadzone
            handPositionSmoothing: 0.18,       // Exponential low-pass filter (0.12 - 0.25)
            handVelocitySmoothing: 0.20,       // Velocity low-pass filter
            handDeadzone: 0.016,               // Micro-tremor deadzone threshold
            responseExponent: 1.35,            // Proportional power curve: pow(input, 1.35)
            
            // Universe 3D Rotation (Smooth & Non-dizzying)
            rotationSensitivity: 0.65,         // Calibrated sensitivity
            rotationDamping: 0.88,             // Inertial rotation damping
            maxRotVelocity: 0.045,             // Maximum rotational speed clamp
            
            // Force Strengths
            gravityStrength: 0.55,
            antiGravityStrength: 0.42,
            vortexStrength: 0.38,
            turbulenceStrength: 0.28,
            singularityStrength: 1.8,

            // Interactive Settings
            sensitivityMode: 'NORMAL',         // 'LOW', 'NORMAL', 'HIGH'
            stabilityMode: true                // Extra damping & hysteresis
        };

        /* ==========================================================================
           2. GLOBAL APPLICATION STATE
           ========================================================================== */
        let scene, camera, renderer;
        let particles, geometry, material;
        let positions, velocities, colors, targetPositions;
        let clock = new THREE.Clock();

        let currentShape = 'sphere';
        let autoRotate = true;
        let isDebugVisible = false;

        // Dedicated Fast Reset System State
        let isResetting = false;
        let resetTimer = 0.0;
        const RESET_DURATION = 0.85; // Target reset completes in ~0.85s

        // Active Shockwaves Pool
        const shockwaves = [];

        // Dynamic Universe Scale controlled smoothly by hand distance
        let universeScale = 1.0;
        let targetUniverseScale = 1.0;
        let smoothedHandDistance = 20.0;

        // Global Energy & Singularity
        let globalEnergy = 0.75;
        let isSingularityActive = false;
        let lastExplosionTime = 0;

        // Fallback Mouse interaction
        const mouseState = {
            x: 0,
            y: 0,
            isDown: false,
            active: false
        };

        // Dual Hand Independent States with Raw & Smoothed Channels
        function createHandState(name, isLeft) {
            return {
                name: name,
                isLeft: isLeft,
                detected: false,
                weight: 0.0,                  // Smooth fade in/out on appearance/disappearance
                targetWeight: 0.0,
                // Raw MediaPipe input
                rawX: 0, rawY: 0, rawZ: 0,
                rawWorldX: 0, rawWorldY: 0, rawWorldZ: 0,
                // Smoothed stable position
                worldX: 0, worldY: 0, worldZ: 0,
                prevWorldX: 0, prevWorldY: 0, prevWorldZ: 0,
                velocity: { x: 0, y: 0, z: 0, speed: 0 },
                palmSize: 0.2,
                pinch: false,
                smoothedPinchDist: 1.0,
                pinchStrength: 0,
                openPalm: false,
                fist: false,
                pointing: false,
                victory: false,
                spread: false,
                pointingDir: { x: 0, y: 1, z: 0 },
                currentGesture: 'NONE',
                gestureConfidence: 0,
                history: []
            };
        }

        const leftHand = createHandState('LEFT', true);
        const rightHand = createHandState('RIGHT', false);

        // Force Weights for Smooth Cross-Fading (Prevents sudden force pops)
        const forceWeights = {
            gravity: 0.0,
            antiGravity: 0.0,
            vortex: 0.0,
            turbulence: 0.0,
            singularity: 0.0
        };

        const dualState = {
            active: false,
            distance: 20.0,
            prevDistance: 20.0,
            separationSpeed: 0,
            midpointWorld: { x: 0, y: 0, z: 0 },
            activeMode: 'IDLE'
        };

        // UI Telemetry Throttler
        let frameCount = 0;
        let lastFpsUpdate = 0;
        let currentFps = 60;

        /* ==========================================================================
           3. THREE.JS INITIALIZATION
           ========================================================================== */
        function init() {
            const container = document.getElementById('canvas-container');

            scene = new THREE.Scene();
            scene.fog = new THREE.FogExp2(0x010103, 0.012);

            camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.z = 36;

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.toneMapping = THREE.ReinhardToneMapping;
            container.appendChild(renderer.domElement);

            createParticleSystem();

            // Event Listeners
            window.addEventListener('resize', onWindowResize, false);
            setupMouseAndKeyboard();

            // Start Render Loop
            animate();

            // Start MediaPipe Hand Tracking
            initMediaPipe();
        }

        /* ==========================================================================
           4. PARTICLE SYSTEM & GLOW TEXTURE
           ========================================================================== */
        function createParticleTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.2, 'rgba(220, 245, 255, 0.95)');
            gradient.addColorStop(0.45, 'rgba(0, 210, 255, 0.45)');
            gradient.addColorStop(0.75, 'rgba(120, 0, 255, 0.12)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);

            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            return texture;
        }

        function createParticleSystem() {
            geometry = new THREE.BufferGeometry();
            positions = new Float32Array(PARTICLE_COUNT * 3);
            velocities = new Float32Array(PARTICLE_COUNT * 3);
            colors = new Float32Array(PARTICLE_COUNT * 3);
            targetPositions = new Float32Array(PARTICLE_COUNT * 3);

            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const i3 = i * 3;
                positions[i3] = (Math.random() - 0.5) * 50;
                positions[i3 + 1] = (Math.random() - 0.5) * 50;
                positions[i3 + 2] = (Math.random() - 0.5) * 50;

                velocities[i3] = 0;
                velocities[i3 + 1] = 0;
                velocities[i3 + 2] = 0;

                colors[i3] = 0.2;
                colors[i3 + 1] = 0.8;
                colors[i3 + 2] = 1.0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

            material = new THREE.PointsMaterial({
                size: PARTICLE_SIZE,
                map: createParticleTexture(),
                vertexColors: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: true,
                opacity: 0.95
            });

            particles = new THREE.Points(geometry, material);
            scene.add(particles);

            generateShape('sphere');
        }

        /* ==========================================================================
           5. SHAPE GENERATION ENGINE (13 MATHEMATICAL FORMATIONS)
           ========================================================================== */
        function generateShape(type) {
            const scale = SHAPE_SCALE;
            const target = targetPositions;

            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const idx = i * 3;
                const u = Math.random();
                const v = Math.random();
                const w = Math.random();
                const theta = 2 * Math.PI * u;
                const phi = Math.acos(2 * v - 1);

                let x = 0, y = 0, z = 0;

                switch (type) {
                    case 'sphere': {
                        const sPhi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT);
                        const sTheta = Math.PI * (1 + Math.sqrt(5)) * i;
                        const r = scale * (0.95 + Math.random() * 0.1);
                        x = r * Math.sin(sPhi) * Math.cos(sTheta);
                        y = r * Math.sin(sPhi) * Math.sin(sTheta);
                        z = r * Math.cos(sPhi);
                        break;
                    }

                    case 'heart': {
                        const t = Math.PI * 2 * u;
                        const r = scale * 0.055 * Math.sqrt(v);
                        const hx = 16 * Math.pow(Math.sin(t), 3);
                        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
                        x = hx * r;
                        y = hy * r + 2;
                        z = (w - 0.5) * scale * 0.7;
                        break;
                    }

                    case 'saturn': {
                        if (i < PARTICLE_COUNT * 0.55) {
                            const rSphere = scale * 0.62;
                            x = rSphere * Math.sin(phi) * Math.cos(theta);
                            y = rSphere * Math.sin(phi) * Math.sin(theta);
                            z = rSphere * Math.cos(phi);
                        } else {
                            const angle = u * Math.PI * 2;
                            const band = Math.random() > 0.4 ? 0.95 : 1.35;
                            const radius = (scale * band) + (v * scale * 0.35);
                            const rx = radius * Math.cos(angle);
                            const rz = radius * Math.sin(angle);
                            const ry = (w - 0.5) * 0.3;
                            const tilt = 0.45;
                            x = rx;
                            y = ry * Math.cos(tilt) - rz * Math.sin(tilt);
                            z = ry * Math.sin(tilt) + rz * Math.cos(tilt);
                        }
                        break;
                    }

                    case 'flower': {
                        const k = 5;
                        const pRadius = scale * (Math.abs(Math.cos(k * theta)) + 0.35);
                        const fPhi = (v * Math.PI) - (Math.PI / 2);
                        x = pRadius * Math.cos(theta) * Math.cos(fPhi);
                        y = pRadius * Math.sin(theta) * Math.cos(fPhi);
                        z = (scale * 0.6) * Math.sin(fPhi);
                        break;
                    }

                    case 'helix': {
                        const hH = (u * 2 - 1) * scale * 1.8;
                        const hR = scale * 0.65;
                        const hA = u * Math.PI * 10;
                        const isEven = (i % 2 === 0);
                        x = hR * Math.cos(hA + (isEven ? 0 : Math.PI));
                        z = hR * Math.sin(hA + (isEven ? 0 : Math.PI));
                        y = hH;
                        x += (Math.random() - 0.5) * 0.6;
                        z += (Math.random() - 0.5) * 0.6;
                        break;
                    }

                    case 'grid': {
                        const dim = Math.floor(Math.cbrt(PARTICLE_COUNT));
                        const spacing = (scale * 2.4) / dim;
                        const offset = (dim * spacing) / 2;
                        const ix = i % dim;
                        const iy = Math.floor(i / dim) % dim;
                        const iz = Math.floor(i / (dim * dim));
                        x = ix * spacing - offset;
                        y = iy * spacing - offset;
                        z = iz * spacing - offset;
                        break;
                    }

                    case 'torus': {
                        const majorR = scale * 0.8;
                        const minorR = scale * 0.32;
                        const tu = u * Math.PI * 2;
                        const tv = v * Math.PI * 2;
                        x = (majorR + minorR * Math.cos(tv)) * Math.cos(tu);
                        y = (majorR + minorR * Math.cos(tv)) * Math.sin(tu);
                        z = minorR * Math.sin(tv);
                        break;
                    }

                    case 'dna': {
                        const tHeight = (u * 2 - 1) * scale * 1.8;
                        const tAngle = u * Math.PI * 8;
                        const dnaRadius = scale * 0.55;

                        if (i % 5 === 0) {
                            const lerpFactor = v * 2 - 1;
                            x = lerpFactor * dnaRadius * Math.cos(tAngle);
                            z = lerpFactor * dnaRadius * Math.sin(tAngle);
                            y = tHeight;
                        } else {
                            const strand = (i % 2 === 0) ? 0 : Math.PI;
                            x = dnaRadius * Math.cos(tAngle + strand) + (Math.random() - 0.5) * 0.4;
                            z = dnaRadius * Math.sin(tAngle + strand) + (Math.random() - 0.5) * 0.4;
                            y = tHeight;
                        }
                        break;
                    }

                    case 'galaxy': {
                        if (i < PARTICLE_COUNT * 0.25) {
                            const coreR = Math.pow(u, 2) * scale * 0.35;
                            x = coreR * Math.sin(phi) * Math.cos(theta);
                            y = coreR * Math.sin(phi) * Math.sin(theta) * 0.7;
                            z = coreR * Math.cos(phi);
                        } else {
                            const arms = 3;
                            const armIdx = i % arms;
                            const armOffset = (armIdx * 2 * Math.PI) / arms;
                            const distFromCenter = Math.pow(u, 0.7) * scale * 1.3 + 1.5;
                            const spiralAngle = distFromCenter * 0.7 + armOffset + (v - 0.5) * 0.4;
                            x = distFromCenter * Math.cos(spiralAngle);
                            z = distFromCenter * Math.sin(spiralAngle);
                            y = (Math.random() - 0.5) * Math.exp(-distFromCenter / (scale * 0.6)) * 4.0;
                        }
                        break;
                    }

                    case 'cube': {
                        const side = scale * 1.6;
                        const half = side / 2;
                        if (i < PARTICLE_COUNT * 0.4) {
                            const edge = Math.floor(Math.random() * 12);
                            const tVal = (Math.random() - 0.5) * side;
                            const c1 = (Math.random() > 0.5 ? 1 : -1) * half;
                            const c2 = (Math.random() > 0.5 ? 1 : -1) * half;
                            if (edge < 4) { x = tVal; y = c1; z = c2; }
                            else if (edge < 8) { x = c1; y = tVal; z = c2; }
                            else { x = c1; y = c2; z = tVal; }
                        } else {
                            const face = Math.floor(Math.random() * 6);
                            const uVal = (Math.random() - 0.5) * side;
                            const vVal = (Math.random() - 0.5) * side;
                            if (face === 0) { x = half; y = uVal; z = vVal; }
                            else if (face === 1) { x = -half; y = uVal; z = vVal; }
                            else if (face === 2) { y = half; x = uVal; z = vVal; }
                            else if (face === 3) { y = -half; x = uVal; z = vVal; }
                            else if (face === 4) { z = half; x = uVal; y = vVal; }
                            else { z = -half; x = uVal; y = vVal; }
                        }
                        break;
                    }

                    case 'star': {
                        const starPoints = 5;
                        const rOut = scale * 1.3;
                        const rIn = scale * 0.45;
                        const currAngle = theta;
                        const modAngle = Math.abs((currAngle % ((2 * Math.PI) / starPoints)) - (Math.PI / starPoints));
                        const rStar = rIn + (rOut - rIn) * Math.cos(modAngle * 2.5);
                        x = rStar * Math.cos(currAngle);
                        y = rStar * Math.sin(currAngle);
                        z = (w - 0.5) * scale * 0.7 * (1 - rStar / rOut);
                        break;
                    }

                    case 'wave': {
                        const wSize = scale * 2.2;
                        x = (u - 0.5) * wSize;
                        z = (v - 0.5) * wSize;
                        const distToOrigin = Math.sqrt(x * x + z * z);
                        y = Math.sin(distToOrigin * 0.6) * 4.2 * Math.cos(x * 0.2);
                        break;
                    }

                    case 'double_helix': {
                        const tVal = (u * 2 - 1) * scale * 1.8;
                        const hAngle = u * Math.PI * 8;
                        const isPrimary = (i % 2 === 0);
                        const phase = isPrimary ? 0 : Math.PI;
                        const rad = scale * 0.65;
                        x = rad * Math.cos(hAngle + phase) + (v - 0.5) * 1.2;
                        z = rad * Math.sin(hAngle + phase) + (w - 0.5) * 1.2;
                        y = tVal;
                        break;
                    }

                    default:
                        x = 0; y = 0; z = 0;
                }

                target[idx] = x;
                target[idx + 1] = y;
                target[idx + 2] = z;
            }
        }

        function setShape(shapeName) {
            currentShape = shapeName;
            document.querySelectorAll('#controls button.shape-btn').forEach(btn => btn.classList.remove('active'));
            const activeBtn = document.getElementById(`btn-${shapeName}`);
            if (activeBtn) activeBtn.classList.add('active');
            generateShape(shapeName);
        }

        /* ==========================================================================
           6. DEDICATED FAST & CONTROLLED RESET SYSTEM
           ========================================================================== */
        function resetParticles() {
            isResetting = true;
            resetTimer = RESET_DURATION;

            // 1. Immediately damp down all particle velocities
            for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
                velocities[i] *= 0.15;
            }

            // 2. Clear all external dynamic forces and shockwaves
            shockwaves.length = 0;
            isSingularityActive = false;
            forceWeights.gravity = 0;
            forceWeights.antiGravity = 0;
            forceWeights.vortex = 0;
            forceWeights.turbulence = 0;
            forceWeights.singularity = 0;

            // 3. Smoothly restore rotation targets to neutral
            targetRotX = 0;
            targetRotY = 0;

            // 4. Restore scale
            targetUniverseScale = 1.0;
            universeScale = 1.0;

            // 5. Update Status UI immediately
            const statusBox = document.getElementById('status-text');
            const statusMsg = document.getElementById('status-msg');
            statusBox.className = "status resetting";
            statusMsg.innerText = "RESETTING FORMATION...";

            const dbgReset = document.getElementById('dbg-reset-status');
            if (dbgReset) {
                dbgReset.innerText = "FAST RESET ACTIVE";
                dbgReset.style.color = "var(--cyan)";
            }
        }

        /* ==========================================================================
           7. SENSITIVITY & STABILITY SETTINGS
           ========================================================================== */
        function setSensitivity(mode) {
            PHYSICS_CONFIG.sensitivityMode = mode;
            document.querySelectorAll('.sens-btn').forEach(btn => btn.classList.remove('active'));
            const btn = document.getElementById(`sens-${mode.toLowerCase()}`);
            if (btn) btn.classList.add('active');
        }

        function toggleStabilityMode() {
            PHYSICS_CONFIG.stabilityMode = !PHYSICS_CONFIG.stabilityMode;
            const btn = document.getElementById('btn-stability');
            btn.innerText = `Stability: ${PHYSICS_CONFIG.stabilityMode ? 'ON' : 'OFF'}`;
            btn.classList.toggle('stability-active', PHYSICS_CONFIG.stabilityMode);
        }

        function toggleAutoRotate() {
            autoRotate = !autoRotate;
            const btn = document.getElementById('btn-autorotate');
            btn.innerText = `Auto-Rotate: ${autoRotate ? 'ON' : 'OFF'}`;
            btn.classList.toggle('active', autoRotate);
        }

        function toggleDebug() {
            isDebugVisible = !isDebugVisible;
            document.getElementById('debug-panel').classList.toggle('visible', isDebugVisible);
            document.getElementById('btn-debug').classList.toggle('active', isDebugVisible);
        }

        function toggleInstructions() {
            const panel = document.getElementById('instructions-panel');
            panel.classList.toggle('collapsed');
            const toggle = panel.querySelector('.inst-toggle');
            toggle.innerText = panel.classList.contains('collapsed') ? 'SHOW' : 'HIDE';
        }

        function triggerShockwave(x, y, z, strength = 1.8, maxRadius = 32, speed = 1.1) {
            if (isResetting) return; // Disallow during reset
            if (shockwaves.length > 5) shockwaves.shift();
            shockwaves.push({
                x: x,
                y: y,
                z: z,
                radius: 0.1,
                maxRadius: maxRadius,
                strength: Math.min(strength, 2.5),
                speed: speed
            });
        }

        /* ==========================================================================
           8. FRAME-RATE INDEPENDENT ADVANCED PHYSICS ENGINE
           ========================================================================== */
        const tmpColor = new THREE.Color();
        let targetRotX = 0;
        let targetRotY = 0;

        function animate() {
            requestAnimationFrame(animate);

            // Frame-rate independent delta time (clamped between 30 and 120 FPS)
            const rawDelta = clock.getDelta();
            const delta = Math.min(Math.max(rawDelta, 0.001), 0.033);
            const time = clock.getElapsedTime();
            const timeScale = delta / (1 / 60); // 1.0 at 60 FPS
            frameCount++;

            // Handle Fast Reset Progress
            if (isResetting) {
                resetTimer -= delta;
                if (resetTimer <= 0) {
                    isResetting = false;
                    const statusBox = document.getElementById('status-text');
                    const statusMsg = document.getElementById('status-msg');
                    statusBox.className = "status";
                    statusMsg.innerText = "SYSTEM STABLE";
                    const dbgReset = document.getElementById('dbg-reset-status');
                    if (dbgReset) {
                        dbgReset.innerText = "IDLE";
                        dbgReset.style.color = "var(--green)";
                    }
                }
            }

            // Sensitivity Multipliers
            let sensMultiplier = 1.0;
            if (PHYSICS_CONFIG.sensitivityMode === 'LOW') sensMultiplier = 0.65;
            else if (PHYSICS_CONFIG.sensitivityMode === 'HIGH') sensMultiplier = 1.35;

            // Stability Mode Adjustments
            const stabilityFactor = PHYSICS_CONFIG.stabilityMode ? 0.75 : 1.0;

            // Universe Scale Interpolation
            universeScale += (targetUniverseScale - universeScale) * (0.08 * timeScale);

            // Morph & Damping Factors based on Reset vs Normal
            const effectiveMorph = isResetting ? 
                PHYSICS_CONFIG.resetMorphSpeed : 
                PHYSICS_CONFIG.springStrength * stabilityFactor;

            const baseDamping = isResetting ? 
                PHYSICS_CONFIG.resetDamping : 
                (PHYSICS_CONFIG.normalDamping - (PHYSICS_CONFIG.stabilityMode ? 0.015 : 0.0));

            // Time-scaled exponential velocity damping
            const effectiveDamping = Math.pow(baseDamping, timeScale);

            // Precision Time-Slow from Right Hand Pinch
            let timeDilation = (rightHand.detected && rightHand.pinch && !isResetting) ? 0.28 : 1.0;

            // Evaluate Modes & Cross-Fade Force Weights
            evaluateSynergyModes(time, delta);

            // Update Active Shockwaves
            for (let s = shockwaves.length - 1; s >= 0; s--) {
                shockwaves[s].radius += shockwaves[s].speed * timeDilation * timeScale;
                if (shockwaves[s].radius > shockwaves[s].maxRadius) {
                    shockwaves.splice(s, 1);
                }
            }

            const pos = positions;
            const vel = velocities;
            const target = targetPositions;
            const col = colors;
            const numShockwaves = shockwaves.length;

            // Hand state caches
            const lWeight = isResetting ? 0 : (leftHand.weight * sensMultiplier);
            const lx = leftHand.worldX, ly = leftHand.worldY, lz = leftHand.worldZ;
            const lPinchStr = leftHand.pinchStrength;

            const rWeight = isResetting ? 0 : (rightHand.weight * sensMultiplier);
            const rx = rightHand.worldX, ry = rightHand.worldY, rz = rightHand.worldZ;

            const midX = dualState.midpointWorld.x;
            const midY = dualState.midpointWorld.y;
            const midZ = dualState.midpointWorld.z;

            // Fallback Mouse
            const mActive = mouseState.active && leftHand.weight < 0.1 && rightHand.weight < 0.1 && !isResetting;
            const mx = mouseState.x * 24, my = mouseState.y * 16;
            const mPinch = mouseState.isDown;

            // Active Force Weights
            const wGrav = forceWeights.gravity * lWeight * PHYSICS_CONFIG.gravityStrength;
            const wAntiGrav = forceWeights.antiGravity * lWeight * PHYSICS_CONFIG.antiGravityStrength;
            const wVort = forceWeights.vortex * lWeight * PHYSICS_CONFIG.vortexStrength;
            const wTurb = forceWeights.turbulence * rWeight * PHYSICS_CONFIG.turbulenceStrength;
            const wSing = forceWeights.singularity * Math.min(lWeight, rWeight) * PHYSICS_CONFIG.singularityStrength;

            const maxForce = PHYSICS_CONFIG.forceLimit * sensMultiplier;
            const maxSpd = PHYSICS_CONFIG.maxParticleSpeed;
            const maxSpdSq = maxSpd * maxSpd;
            const maxRadSq = PHYSICS_CONFIG.maxParticleRadius * PHYSICS_CONFIG.maxParticleRadius;

            // Main 18,000 Particle Simulation Loop (Zero Object Allocation)
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const i3 = i * 3;
                const px = pos[i3];
                const py = pos[i3 + 1];
                const pz = pos[i3 + 2];

                // 1. Spring Force toward Scaled Target Shape
                const tx = target[i3] * universeScale;
                const ty = target[i3 + 1] * universeScale;
                const tz = target[i3 + 2] * universeScale;

                let fx = (tx - px) * effectiveMorph * timeScale;
                let fy = (ty - py) * effectiveMorph * timeScale;
                let fz = (tz - pz) * effectiveMorph * timeScale;

                // 2. Dynamic Ambient Noise & Turbulence
                if (wTurb > 0.01) {
                    fx += Math.sin(py * 0.04 + time * 1.5) * wTurb * timeScale;
                    fy += Math.cos(px * 0.04 + time * 1.5) * wTurb * timeScale;
                    fz += Math.sin((px + py) * 0.03 + time * 1.2) * (wTurb * 0.8) * timeScale;
                }

                // 3. Right Hand Orbit Mode
                if (rWeight > 0.1 && rightHand.victory && !isResetting) {
                    const orbitDist = Math.sqrt(px * px + pz * pz) + 0.1;
                    const oForce = 0.35 * rWeight * timeScale;
                    fx += (-pz / orbitDist) * oForce;
                    fz += (px / orbitDist) * oForce;
                }

                // 4. Dual Gravity Singularity Collapse (Both Hands Pinch)
                if (wSing > 0.05) {
                    const dx = midX - px;
                    const dy = midY - py;
                    const dz = midZ - pz;
                    const distSq = dx * dx + dy * dy + dz * dz + 0.5;
                    const singForce = Math.min(25.0 / (distSq + 2.0), 1.2) * wSing * timeScale;

                    fx += dx * singForce;
                    fy += dy * singForce;
                    fz += dz * singForce;

                    // Controlled vortex around singularity
                    fx += dy * (0.18 * wSing * timeScale);
                    fy -= dx * (0.18 * wSing * timeScale);
                }
                // 5. Left Hand Forces (Attraction, Anti-gravity, Vortex, Beam)
                else if (lWeight > 0.05) {
                    const dx = lx - px;
                    const dy = ly - py;
                    const dz = lz - pz;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    const dist = Math.sqrt(distSq) + 0.1;

                    if (dist < 26.0) {
                        const falloff = (26.0 - dist) / 26.0;

                        if (wGrav > 0.01) {
                            // Left Pinch: Gravity Well
                            const pull = falloff * (0.35 + lPinchStr * 0.45) * wGrav * timeScale;
                            fx += dx * pull;
                            fy += dy * pull;
                            fz += dz * pull;
                        } else if (wAntiGrav > 0.01) {
                            // Left Open Palm: Anti-Gravity Field
                            const push = falloff * 0.28 * wAntiGrav * timeScale;
                            fx -= dx * push;
                            fy -= dy * push;
                            fz -= dz * push;
                        } else if (leftHand.fist) {
                            // Left Fist: Compression towards center
                            const comp = falloff * 0.12 * lWeight * timeScale;
                            fx -= px * comp;
                            fy -= py * comp;
                            fz -= pz * comp;
                        } else if (wVort > 0.01) {
                            // Left Victory: Particle Vortex
                            const vForce = falloff * 0.32 * wVort * timeScale;
                            fx += dy * vForce;
                            fy -= dx * vForce;
                        } else if (leftHand.pointing) {
                            // Left Pointing: Directional force beam
                            const bForce = falloff * 0.55 * lWeight * timeScale;
                            fx += leftHand.pointingDir.x * bForce;
                            fy += leftHand.pointingDir.y * bForce;
                            fz += leftHand.pointingDir.z * bForce;
                        }
                    }
                }

                // 6. Gravity vs Anti-Gravity Synergy Flux
                if (dualState.active && !isResetting && forceWeights.singularity < 0.1) {
                    if (leftHand.pinch && rightHand.openPalm) {
                        const rdx = rx - px, rdy = ry - py, rdz = rz - pz;
                        const rdist = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) + 0.1;
                        if (rdist < 22) {
                            const rpush = (22 - rdist) / 22 * 0.22 * rWeight * timeScale;
                            fx -= rdx * rpush; fy -= rdy * rpush; fz -= rdz * rpush;
                        }
                    } else if (leftHand.openPalm && rightHand.pinch) {
                        const rdx = rx - px, rdy = ry - py, rdz = rz - pz;
                        const rdist = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) + 0.1;
                        if (rdist < 22) {
                            const rpull = (22 - rdist) / 22 * 0.35 * rWeight * timeScale;
                            fx += rdx * rpull; fy += rdy * rpull; fz += rdz * rpull;
                        }
                    }
                }

                // 7. Active Shockwaves
                for (let s = 0; s < numShockwaves; s++) {
                    const sw = shockwaves[s];
                    const wdx = px - sw.x;
                    const wdy = py - sw.y;
                    const wdz = pz - sw.z;
                    const wdist = Math.sqrt(wdx * wdx + wdy * wdy + wdz * wdz) + 0.01;
                    const ringDelta = Math.abs(wdist - sw.radius);

                    if (ringDelta < 3.0) {
                        const waveFactor = ((3.0 - ringDelta) / 3.0) * (sw.strength / (wdist * 0.2 + 1.0)) * timeScale;
                        fx += (wdx / wdist) * waveFactor * 0.6;
                        fy += (wdy / wdist) * waveFactor * 0.6;
                        fz += (wdz / wdist) * waveFactor * 0.6;
                    }
                }

                // 8. Fallback Mouse Force
                if (mActive) {
                    const mdx = mx - px, mdy = my - py, mdz = -pz;
                    const mdist = Math.sqrt(mdx * mdx + mdy * mdy + mdz * mdz) + 0.1;
                    if (mdist < 20) {
                        const mforce = (20 - mdist) / 20 * timeScale;
                        if (mPinch) {
                            fx += mdx * mforce * 0.35;
                            fy += mdy * mforce * 0.35;
                            fz += mdz * mforce * 0.35;
                        } else {
                            fx -= mdx * mforce * 0.12;
                            fy -= mdy * mforce * 0.12;
                            fz -= mdz * mforce * 0.12;
                            fx += mdy * mforce * 0.15;
                            fy -= mdx * mforce * 0.15;
                        }
                    }
                }

                // 9. Particle Force Clamping (Prevents excessive impulse)
                const totalForceSq = fx * fx + fy * fy + fz * fz;
                if (totalForceSq > maxForce * maxForce) {
                    const fScale = maxForce / Math.sqrt(totalForceSq);
                    fx *= fScale;
                    fy *= fScale;
                    fz *= fScale;
                }

                // 10. Integrate Velocity & Position
                let nvx = (vel[i3] + fx) * effectiveDamping;
                let nvy = (vel[i3 + 1] + fy) * effectiveDamping;
                let nvz = (vel[i3 + 2] + fz) * effectiveDamping;

                // Max Particle Speed Clamp
                const curSpdSq = nvx * nvx + nvy * nvy + nvz * nvz;
                if (curSpdSq > maxSpdSq) {
                    const spdScale = maxSpd / Math.sqrt(curSpdSq);
                    nvx *= spdScale;
                    nvy *= spdScale;
                    nvz *= spdScale;
                }

                vel[i3] = Number.isFinite(nvx) ? nvx : 0;
                vel[i3 + 1] = Number.isFinite(nvy) ? nvy : 0;
                vel[i3 + 2] = Number.isFinite(nvz) ? nvz : 0;

                pos[i3] += vel[i3];
                pos[i3 + 1] += vel[i3 + 1];
                pos[i3 + 2] += vel[i3 + 2];

                // 11. Emergency Boundary Recovery
                const curRadSq = pos[i3] * pos[i3] + pos[i3 + 1] * pos[i3 + 1] + pos[i3 + 2] * pos[i3 + 2];
                if (curRadSq > maxRadSq || !Number.isFinite(curRadSq)) {
                    pos[i3] = tx;
                    pos[i3 + 1] = ty;
                    pos[i3 + 2] = tz;
                    vel[i3] = 0; vel[i3 + 1] = 0; vel[i3 + 2] = 0;
                }

                // 12. Dynamic Particle Colors
                let hue = 0.55, sat = 0.9, light = 0.6;

                if (isSingularityActive) {
                    const dMid = Math.sqrt((px - midX) ** 2 + (py - midY) ** 2 + (pz - midZ) ** 2);
                    const coreProximity = Math.max(0, 1 - dMid / 12);
                    hue = 0.11 + coreProximity * 0.05;
                    sat = 1.0 - coreProximity * 0.5;
                    light = 0.65 + coreProximity * 0.35;
                } else if (wGrav > 0.2) {
                    hue = 0.10 + Math.min(curSpdSq * 0.06, 0.08);
                    sat = 1.0;
                    light = 0.65 + Math.min(curSpdSq * 0.1, 0.3);
                } else if (wAntiGrav > 0.2) {
                    hue = 0.50 + Math.sin(time + px * 0.05) * 0.04;
                    sat = 0.95;
                    light = 0.70;
                } else if (wVort > 0.2) {
                    hue = 0.76 + Math.cos(time + py * 0.05) * 0.05;
                    sat = 0.95;
                    light = 0.65;
                } else if (wTurb > 0.15) {
                    hue = 0.88 + Math.sin(time * 2 + px * 0.05) * 0.08;
                    sat = 1.0;
                    light = 0.65;
                } else {
                    hue = ((px * 0.015) + (py * 0.015) + (time * 0.08)) % 1.0;
                    if (hue < 0) hue += 1.0;
                    sat = 0.88;
                    light = 0.60;
                }

                tmpColor.setHSL(hue, sat, light);
                col[i3] += (tmpColor.r - col[i3]) * 0.12;
                col[i3 + 1] += (tmpColor.g - col[i3 + 1]) * 0.12;
                col[i3 + 2] += (tmpColor.b - col[i3 + 2]) * 0.12;
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.color.needsUpdate = true;

            // 13. Controlled Universe 3D Rotation with Limits & Damping
            updateUniverseRotation(delta, timeScale, sensMultiplier);

            // 14. Render Scene
            renderer.render(scene, camera);

            // 15. Throttled UI & Diagnostics
            if (frameCount % 4 === 0) {
                updateUITelemetry(time);
            }
        }

        /* ==========================================================================
           9. DUAL-HAND SYNERGY & FORCE WEIGHT CROSS-FADING
           ========================================================================== */
        function evaluateSynergyModes(time, delta) {
            // Smooth Hand Weight Fade-in / Fade-out (Prevents sudden jumps on entry/exit)
            leftHand.targetWeight = leftHand.detected ? 1.0 : 0.0;
            rightHand.targetWeight = rightHand.detected ? 1.0 : 0.0;

            const fadeSpeed = delta * 5.0; // ~200ms smooth fade
            leftHand.weight += (leftHand.targetWeight - leftHand.weight) * fadeSpeed;
            rightHand.weight += (rightHand.targetWeight - rightHand.weight) * fadeSpeed;

            dualState.active = (leftHand.weight > 0.4 && rightHand.weight > 0.4);

            if (dualState.active) {
                // Smoothed Midpoint (No jitter in singularity)
                const rawMidX = (leftHand.worldX + rightHand.worldX) * 0.5;
                const rawMidY = (leftHand.worldY + rightHand.worldY) * 0.5;
                const rawMidZ = (leftHand.worldZ + rightHand.worldZ) * 0.5;

                dualState.midpointWorld.x += (rawMidX - dualState.midpointWorld.x) * 0.15;
                dualState.midpointWorld.y += (rawMidY - dualState.midpointWorld.y) * 0.15;
                dualState.midpointWorld.z += (rawMidZ - dualState.midpointWorld.z) * 0.15;

                // Smoothed Distance Between Hands
                const hdx = rightHand.worldX - leftHand.worldX;
                const hdy = rightHand.worldY - leftHand.worldY;
                const hdz = rightHand.worldZ - leftHand.worldZ;
                const rawDistance = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);

                dualState.distance += (rawDistance - dualState.distance) * 0.12;

                if (dualState.prevDistance > 0) {
                    dualState.separationSpeed = (dualState.distance - dualState.prevDistance) / delta;
                }
                dualState.prevDistance = dualState.distance;

                // Controlled Universe Scale
                const normalizedSpan = Math.min(Math.max(dualState.distance / 20.0, 0.6), 1.6);
                targetUniverseScale = normalizedSpan;

                // Dual Combinations
                if (leftHand.pinch && rightHand.pinch) {
                    dualState.activeMode = 'SINGULARITY COLLAPSE';
                    isSingularityActive = true;
                    globalEnergy = Math.min(globalEnergy + 0.02, 1.0);
                } else if (leftHand.openPalm && rightHand.openPalm) {
                    dualState.activeMode = 'ANTIGRAVITY BLAST';
                    isSingularityActive = false;

                    // Requires hands actively separating and fast separation velocity
                    if (dualState.separationSpeed > 4.5 && (time - lastExplosionTime > 1.6)) {
                        lastExplosionTime = time;
                        triggerShockwave(dualState.midpointWorld.x, dualState.midpointWorld.y, dualState.midpointWorld.z, 3.8, 42, 1.5);
                    }
                } else if (leftHand.pinch && rightHand.openPalm) {
                    dualState.activeMode = 'GRAVITY vs ANTIGRAVITY';
                    isSingularityActive = false;
                } else if (leftHand.openPalm && rightHand.pinch) {
                    dualState.activeMode = 'ANTIGRAVITY vs GRAVITY';
                    isSingularityActive = false;
                } else if (leftHand.fist && rightHand.fist) {
                    dualState.activeMode = 'PARTICLE COMPRESSOR';
                    targetUniverseScale = 0.45;
                    isSingularityActive = false;
                } else if (leftHand.victory && rightHand.victory) {
                    dualState.activeMode = 'DUAL ORBITAL FIELD';
                    isSingularityActive = false;
                } else {
                    dualState.activeMode = 'INDEPENDENT DUAL CHANNELS';
                    isSingularityActive = false;
                }
            } else {
                isSingularityActive = false;
                targetUniverseScale = 1.0;

                if (leftHand.weight > 0.2) {
                    dualState.activeMode = `LEFT: ${leftHand.currentGesture}`;
                } else if (rightHand.weight > 0.2) {
                    dualState.activeMode = `RIGHT: ${rightHand.currentGesture}`;
                } else if (mouseState.active) {
                    dualState.activeMode = mouseState.isDown ? 'MOUSE GRAVITY' : 'MOUSE ROTATE';
                } else {
                    dualState.activeMode = 'COSMIC DRIFT (AUTO)';
                }
            }

            // Target Force Weights based on Gestures
            const targetGrav = (leftHand.pinch && !isSingularityActive) ? 1.0 : 0.0;
            const targetAntiGrav = (leftHand.openPalm && !isSingularityActive) ? 1.0 : 0.0;
            const targetVort = (leftHand.victory && !isSingularityActive) ? 1.0 : 0.0;
            const targetTurb = (rightHand.fist && !isSingularityActive) ? 1.0 : 0.0;
            const targetSing = isSingularityActive ? 1.0 : 0.0;

            // Smooth Force Cross-Fading (0.15 lerp rate prevents abrupt jolts)
            const blendRate = delta * 8.0;
            forceWeights.gravity += (targetGrav - forceWeights.gravity) * blendRate;
            forceWeights.antiGravity += (targetAntiGrav - forceWeights.antiGravity) * blendRate;
            forceWeights.vortex += (targetVort - forceWeights.vortex) * blendRate;
            forceWeights.turbulence += (targetTurb - forceWeights.turbulence) * blendRate;
            forceWeights.singularity += (targetSing - forceWeights.singularity) * blendRate;
        }

        /* ==========================================================================
           10. STABILIZED 3D ROTATION ENGINE
           ========================================================================== */
        function updateUniverseRotation(delta, timeScale, sensMultiplier) {
            if (isResetting) {
                // Smoothly return scene rotation to zero
                scene.rotation.x *= 0.85;
                scene.rotation.y *= 0.85;
                scene.rotation.z *= 0.85;
                return;
            }

            if (rightHand.weight > 0.2 && !rightHand.pinch) {
                // Right Hand drives rotation proportionally using smoothed velocity
                const rotFactor = PHYSICS_CONFIG.rotationSensitivity * sensMultiplier * 0.04;
                let dRotY = rightHand.velocity.x * rotFactor;
                let dRotX = -rightHand.velocity.y * rotFactor;

                // Clamp rotational velocity
                const maxR = PHYSICS_CONFIG.maxRotVelocity;
                dRotY = Math.min(Math.max(dRotY, -maxR), maxR);
                dRotX = Math.min(Math.max(dRotX, -maxR), maxR);

                targetRotY += dRotY;
                targetRotX += dRotX;
            } else if (mouseState.active && leftHand.weight < 0.1 && rightHand.weight < 0.1 && !mouseState.isDown) {
                targetRotY = mouseState.x * 1.2;
                targetRotX = -mouseState.y * 0.9;
            } else if (autoRotate && leftHand.weight < 0.1 && rightHand.weight < 0.1) {
                targetRotY += 0.004 * timeScale;
                targetRotX = Math.sin(clock.getElapsedTime() * 0.3) * 0.12;
            }

            // Smooth scene rotation with inertia
            const rotDamp = 0.07 * timeScale;
            scene.rotation.y += (targetRotY - scene.rotation.y) * rotDamp;
            scene.rotation.x += (targetRotX - scene.rotation.x) * rotDamp;
        }

        /* ==========================================================================
           11. MEDIAPIPE TRACKING & SMOOTHED LANDMARKS
           ========================================================================== */
        function initMediaPipe() {
            const videoElement = document.getElementById('input_video');
            const previewCanvas = document.getElementById('webcam-preview');
            const previewCtx = previewCanvas.getContext('2d');
            const statusMsg = document.getElementById('status-msg');
            const statusBox = document.getElementById('status-text');

            previewCanvas.width = 320;
            previewCanvas.height = 240;

            const hands = new Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });

            hands.setOptions({
                maxNumHands: 2,
                modelComplexity: 1,
                minDetectionConfidence: 0.58,
                minTrackingConfidence: 0.58
            });

            hands.onResults((results) => {
                previewCtx.save();
                previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                previewCtx.drawImage(results.image, 0, 0, previewCanvas.width, previewCanvas.height);

                let detectedLeft = false;
                let detectedRight = false;

                if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                    const count = results.multiHandLandmarks.length;

                    for (let h = 0; h < count; h++) {
                        const landmarks = results.multiHandLandmarks[h];
                        let handedness = 'Left';

                        if (results.multiHandedness && results.multiHandedness[h]) {
                            handedness = results.multiHandedness[h].label;
                        }

                        // Mirrored display handedness mapping
                        let isLeft = false;
                        if (count === 2) {
                            isLeft = (landmarks[0].x > results.multiHandLandmarks[1 - h][0].x);
                        } else {
                            isLeft = (handedness === 'Left');
                        }

                        const targetHand = isLeft ? leftHand : rightHand;
                        if (isLeft) detectedLeft = true;
                        else detectedRight = true;

                        // Process Landmarks & Filter Jitter
                        processHandLandmarks(targetHand, landmarks);

                        // Draw Skeleton Overlay
                        drawHandSkeleton(previewCtx, landmarks, isLeft, targetHand);
                    }

                    if (!isResetting) {
                        statusBox.className = "status";
                        statusMsg.innerText = `Dual Tracking Active (${count}/2 Hands)`;
                    }
                } else {
                    if (!isResetting) {
                        statusBox.className = "status loading";
                        statusMsg.innerText = "Searching for Hands (Mouse Control Active)...";
                    }
                }

                leftHand.detected = detectedLeft;
                rightHand.detected = detectedRight;

                previewCtx.restore();
            });

            const camera = new Camera(videoElement, {
                onFrame: async () => {
                    await hands.send({ image: videoElement });
                },
                width: 320,
                height: 240
            });

            camera.start()
                .then(() => {
                    if (!isResetting) {
                        statusBox.className = "status";
                        statusMsg.innerText = "Webcam Dual Engine Ready!";
                    }
                })
                .catch((err) => {
                    console.warn("Camera permission denied or unavailable:", err);
                    statusBox.className = "status error";
                    statusMsg.innerText = "Camera Denied — Mouse Mode Active";
                });
        }

        /* ==========================================================================
           12. PROPORTIONAL SMOOTHING, DEADZONE & GESTURE HYSTERESIS
           ========================================================================== */
        function dist3D(p1, p2) {
            const dx = p1.x - p2.x, dy = p1.y - p2.y, dz = (p1.z || 0) - (p2.z || 0);
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        function processHandLandmarks(hand, lm) {
            // Raw screen coords
            const palmCenter = lm[9]; // Middle MCP
            hand.rawX = (1 - palmCenter.x) * 2 - 1;
            hand.rawY = -(palmCenter.y * 2 - 1);
            hand.rawZ = -(palmCenter.z || 0);

            // Raw Three.js world space coordinates
            hand.rawWorldX = hand.rawX * 24;
            hand.rawWorldY = hand.rawY * 16;
            hand.rawWorldZ = hand.rawZ * 12;

            // Deadzone & Exponential Position Smoothing
            const dWorldX = hand.rawWorldX - hand.worldX;
            const dWorldY = hand.rawWorldY - hand.worldY;
            const dWorldZ = hand.rawWorldZ - hand.worldZ;
            const rawDist = Math.sqrt(dWorldX * dWorldX + dWorldY * dWorldY + dWorldZ * dWorldZ);

            // Deadzone filter to eliminate micro-tremors
            const deadzone = PHYSICS_CONFIG.handDeadzone * (PHYSICS_CONFIG.stabilityMode ? 1.25 : 1.0) * 15.0;
            if (rawDist > deadzone) {
                // Proportional response curve
                const normalizedMovement = Math.min(rawDist / 8.0, 1.0);
                const curveFactor = Math.pow(normalizedMovement, PHYSICS_CONFIG.responseExponent);
                const posSmoothing = PHYSICS_CONFIG.handPositionSmoothing * (0.65 + curveFactor * 0.35);

                hand.worldX += dWorldX * posSmoothing;
                hand.worldY += dWorldY * posSmoothing;
                hand.worldZ += dWorldZ * posSmoothing;
            }

            // Velocity Tracking & Clamping (Rejects tracking jumps)
            if (hand.prevWorldX !== 0 || hand.prevWorldY !== 0) {
                const vxRaw = hand.worldX - hand.prevWorldX;
                const vyRaw = hand.worldY - hand.prevWorldY;
                const vzRaw = hand.worldZ - hand.prevWorldZ;
                const rawSpeed = Math.sqrt(vxRaw * vxRaw + vyRaw * vyRaw + vzRaw * vzRaw);

                // Max hand speed clamp
                const maxSpd = PHYSICS_CONFIG.maxHandSpeed;
                const spdScale = rawSpeed > maxSpd ? (maxSpd / rawSpeed) : 1.0;
                const cvx = vxRaw * spdScale;
                const cvy = vyRaw * spdScale;
                const cvz = vzRaw * spdScale;

                const velSmoothing = PHYSICS_CONFIG.handVelocitySmoothing;
                hand.velocity.x += (cvx - hand.velocity.x) * velSmoothing;
                hand.velocity.y += (cvy - hand.velocity.y) * velSmoothing;
                hand.velocity.z += (cvz - hand.velocity.z) * velSmoothing;
                hand.velocity.speed = Math.sqrt(hand.velocity.x ** 2 + hand.velocity.y ** 2 + hand.velocity.z ** 2);
            }
            hand.prevWorldX = hand.worldX;
            hand.prevWorldY = hand.worldY;
            hand.prevWorldZ = hand.worldZ;

            // Palm Size Normalization
            const wrist = lm[0];
            const palmRef = dist3D(wrist, lm[9]);
            hand.palmSize = Math.max(palmRef, 0.08);

            // Extended Finger Identification
            const isIndexExt = dist3D(lm[8], wrist) > dist3D(lm[6], wrist) * 1.15;
            const isMiddleExt = dist3D(lm[12], wrist) > dist3D(lm[10], wrist) * 1.15;
            const isRingExt = dist3D(lm[16], wrist) > dist3D(lm[14], wrist) * 1.15;
            const isPinkyExt = dist3D(lm[20], wrist) > dist3D(lm[18], wrist) * 1.15;

            // Smoothed Pinch with Hysteresis (Enter at 0.28, Exit at 0.35)
            const thumbTip = lm[4];
            const rawPinch = dist3D(thumbTip, lm[8]) / hand.palmSize;
            hand.smoothedPinchDist += (rawPinch - hand.smoothedPinchDist) * 0.25;

            const pinchEnterThresh = 0.28;
            const pinchExitThresh = 0.35;

            if (hand.pinch) {
                if (hand.smoothedPinchDist > pinchExitThresh) hand.pinch = false;
            } else {
                if (hand.smoothedPinchDist < pinchEnterThresh) hand.pinch = true;
            }
            hand.pinchStrength = Math.min(Math.max((pinchExitThresh - hand.smoothedPinchDist) / 0.2, 0), 1);

            // Pointing Vector
            const pDirX = lm[8].x - lm[6].x;
            const pDirY = -(lm[8].y - lm[6].y);
            const pDirZ = -(lm[8].z - lm[6].z);
            const pLen = Math.sqrt(pDirX * pDirX + pDirY * pDirY + pDirZ * pDirZ) || 1;
            hand.pointingDir.x = pDirX / pLen;
            hand.pointingDir.y = pDirY / pLen;
            hand.pointingDir.z = pDirZ / pLen;

            // Gesture Classification
            let rawGesture = 'UNKNOWN';

            if (hand.pinch) {
                rawGesture = 'PINCH';
            } else if (!isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
                rawGesture = 'FIST';
            } else if (isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
                rawGesture = 'POINTING';
            } else if (isIndexExt && isMiddleExt && !isRingExt && !isPinkyExt) {
                rawGesture = 'VICTORY';
            } else if (isIndexExt && isMiddleExt && isRingExt && isPinkyExt) {
                const fingerSpread = dist3D(lm[8], lm[20]) / hand.palmSize;
                rawGesture = (fingerSpread > 1.25) ? 'SPREAD' : 'OPEN PALM';
            } else {
                rawGesture = 'OPEN PALM';
            }

            // Hysteresis Frame Counter (Requires 4 out of 5 frames in stability mode)
            if (hand.history.length >= 5) hand.history.shift();
            hand.history.push(rawGesture);

            const counts = {};
            hand.history.forEach(g => counts[g] = (counts[g] || 0) + 1);
            let dominantGesture = rawGesture;
            let maxCount = 0;
            for (const g in counts) {
                if (counts[g] > maxCount) {
                    maxCount = counts[g];
                    dominantGesture = g;
                }
            }

            const requiredCount = PHYSICS_CONFIG.stabilityMode ? 4 : 3;
            if (maxCount >= requiredCount) {
                hand.currentGesture = dominantGesture;
            }

            hand.openPalm = (hand.currentGesture === 'OPEN PALM');
            hand.fist = (hand.currentGesture === 'FIST');
            hand.pointing = (hand.currentGesture === 'POINTING');
            hand.victory = (hand.currentGesture === 'VICTORY');
            hand.spread = (hand.currentGesture === 'SPREAD');

            // Trigger Shockwave on Left Finger Spread with speed requirement
            if (hand.isLeft && hand.spread && hand.velocity.speed > 1.2 && !isResetting) {
                triggerShockwave(hand.worldX, hand.worldY, hand.worldZ, 2.5, 32, 1.3);
            }
        }

        /* ==========================================================================
           13. SKELETON CANVAS RENDERING
           ========================================================================== */
        function drawHandSkeleton(ctx, lm, isLeft, hand) {
            const w = ctx.canvas.width;
            const h = ctx.canvas.height;
            const strokeColor = isLeft ? '#00e5ff' : '#ff007f';
            const nodeColor = '#ffffff';

            drawConnectors(ctx, lm, HAND_CONNECTIONS, { color: strokeColor, lineWidth: 3 });
            drawLandmarks(ctx, lm, { color: nodeColor, lineWidth: 1.5, radius: 2.5 });

            if (hand.pinch) {
                const thumbPt = lm[4];
                const indexPt = lm[8];
                const px = (thumbPt.x + indexPt.x) * 0.5 * w;
                const py = (thumbPt.y + indexPt.y) * 0.5 * h;

                ctx.beginPath();
                ctx.arc(px, py, 10 + hand.pinchStrength * 8, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffb703';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            const wrist = lm[0];
            const lx = wrist.x * w;
            const ly = Math.max(wrist.y * h - 15, 20);

            ctx.save();
            ctx.scale(-1, 1);
            ctx.font = 'bold 11px monospace';
            ctx.fillStyle = strokeColor;
            ctx.fillText(`${hand.name}: ${hand.currentGesture}`, -lx + 10, ly);
            ctx.restore();
        }

        /* ==========================================================================
           14. MOUSE & KEYBOARD FALLBACK CONTROLS
           ========================================================================== */
        function setupMouseAndKeyboard() {
            window.addEventListener('mousemove', (e) => {
                if (leftHand.weight > 0.1 || rightHand.weight > 0.1) return;
                mouseState.x = (e.clientX / window.innerWidth) * 2 - 1;
                mouseState.y = -(e.clientY / window.innerHeight) * 2 + 1;
                mouseState.active = true;
            });

            window.addEventListener('mousedown', () => {
                mouseState.isDown = true;
                if (leftHand.weight < 0.1 && rightHand.weight < 0.1) {
                    document.body.style.cursor = 'grabbing';
                }
            });

            window.addEventListener('mouseup', () => {
                mouseState.isDown = false;
                document.body.style.cursor = 'default';
            });

            // Keyboard Shortcuts
            window.addEventListener('keydown', (e) => {
                const key = e.key;
                if (key === '1') setShape('sphere');
                else if (key === '2') setShape('heart');
                else if (key === '3') setShape('saturn');
                else if (key === '4') setShape('flower');
                else if (key === '5') setShape('helix');
                else if (key === '6') setShape('grid');
                else if (key === '7') setShape('torus');
                else if (key === '8') setShape('dna');
                else if (key === '9') setShape('galaxy');
                else if (key === '0') setShape('cube');
                else if (key === '-') setShape('star');
                else if (key === '=') setShape('wave');
                else if (key === '[') setShape('double_helix');
                else if (key === ' ') { e.preventDefault(); toggleAutoRotate(); }
                else if (key === 'd' || key === 'D') toggleDebug();
                else if (key === 'r' || key === 'R') resetParticles();
                else if (key === 'g' || key === 'G') triggerShockwave(0, 0, 0, -2.5, 28, 1.1);
                else if (key === 'a' || key === 'A') triggerShockwave(0, 0, 0, 3.5, 38, 1.4);
            });
        }

        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        /* ==========================================================================
           15. UI & TELEMETRY UPDATES (THROTTLED)
           ========================================================================== */
        function updateUITelemetry(time) {
            // FPS Counter
            if (time - lastFpsUpdate >= 0.5) {
                currentFps = Math.round(frameCount / (time - lastFpsUpdate));
                frameCount = 0;
                lastFpsUpdate = time;
                document.getElementById('hud-fps').innerText = `${currentFps} FPS`;
                if (isDebugVisible) document.getElementById('dbg-fps').innerText = `${currentFps} FPS`;
            }

            // HUD Cards
            const leftGestEl = document.getElementById('hud-left-gesture');
            const leftSubEl = document.getElementById('hud-left-sub');
            if (leftHand.weight > 0.1) {
                leftGestEl.innerText = leftHand.currentGesture;
                leftSubEl.innerText = leftHand.pinch ? `Gravity [${Math.round(leftHand.pinchStrength * 100)}%]` : 'Force Active';
            } else {
                leftGestEl.innerText = 'NOT DETECTED';
                leftSubEl.innerText = 'Channel: Gravity';
            }

            const rightGestEl = document.getElementById('hud-right-gesture');
            const rightSubEl = document.getElementById('hud-right-sub');
            if (rightHand.weight > 0.1) {
                rightGestEl.innerText = rightHand.currentGesture;
                rightSubEl.innerText = rightHand.pinch ? 'Precision Mode' : 'Universe Active';
            } else {
                rightGestEl.innerText = 'NOT DETECTED';
                rightSubEl.innerText = 'Channel: Orbit/Rotate';
            }

            // Active Mode Value
            document.getElementById('hud-mode-value').innerText = isResetting ? "RESETTING..." : dualState.activeMode;

            // Energy Bar Calculation
            let energyVal = 55;
            if (isResetting) energyVal = 20;
            else if (isSingularityActive) energyVal = 98;
            else if (dualState.active) energyVal = 85;
            else if (leftHand.weight > 0.2 || rightHand.weight > 0.2) energyVal = 70;

            document.getElementById('hud-energy-text').innerText = `${energyVal}%`;
            document.getElementById('hud-energy-bar').style.width = `${energyVal}%`;

            // Debug Overlay Diagnostics
            if (isDebugVisible) {
                const count = (leftHand.detected ? 1 : 0) + (rightHand.detected ? 1 : 0);
                document.getElementById('dbg-hands-count').innerText = `${count}/2 (L_wt:${leftHand.weight.toFixed(2)}, R_wt:${rightHand.weight.toFixed(2)})`;

                document.getElementById('dbg-left-raw').innerText = leftHand.detected ?
                    `(${leftHand.rawWorldX.toFixed(1)}, ${leftHand.rawWorldY.toFixed(1)})` : 'N/A';
                document.getElementById('dbg-left-smooth').innerText = leftHand.detected ?
                    `(${leftHand.worldX.toFixed(1)}, ${leftHand.worldY.toFixed(1)})` : 'N/A';
                document.getElementById('dbg-left-gest').innerText = leftHand.detected ?
                    `${leftHand.velocity.speed.toFixed(2)} | ${leftHand.currentGesture}` : 'N/A';

                document.getElementById('dbg-right-raw').innerText = rightHand.detected ?
                    `(${rightHand.rawWorldX.toFixed(1)}, ${rightHand.rawWorldY.toFixed(1)})` : 'N/A';
                document.getElementById('dbg-right-smooth').innerText = rightHand.detected ?
                    `(${rightHand.worldX.toFixed(1)}, ${rightHand.worldY.toFixed(1)})` : 'N/A';
                document.getElementById('dbg-right-gest').innerText = rightHand.detected ?
                    `${rightHand.velocity.speed.toFixed(2)} | ${rightHand.currentGesture}` : 'N/A';

                document.getElementById('dbg-hand-span').innerText = dualState.active ?
                    `${dualState.distance.toFixed(2)} (Scale: ${universeScale.toFixed(2)})` : 'N/A';
                document.getElementById('dbg-limits').innerText = `MaxSpd:${PHYSICS_CONFIG.maxParticleSpeed} | ForceLim:${PHYSICS_CONFIG.forceLimit}`;
                document.getElementById('dbg-reset-status').innerText = isResetting ? `ACTIVE (${resetTimer.toFixed(2)}s)` : 'IDLE';
            }
        }

        // Initialize on DOM load
        window.addEventListener('DOMContentLoaded', init);
