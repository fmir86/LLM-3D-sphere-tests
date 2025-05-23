import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const NUM_IMAGES = 1000; // Keep this manageable for dev; 1000 is a lot to animate in!
const PICSUM_IMAGE_SIZE = 150;
const SPHERE_RADIUS = 10;
const PLANE_SIZE = 1;

const INTRO_ANIM_DURATION = 3000; // milliseconds for intro animation
const INTRO_ANIM_STAGGER = 1500; // ms; max random delay for staggering individual animations

let scene, camera, renderer, controls;
const textureLoader = new THREE.TextureLoader();
const loadingMessage = document.getElementById('loading-message');

let imagesToLoadCount = NUM_IMAGES;
let imagesLoadedCount = 0;

const imagePlanesData = []; // To store mesh, targetPos, curve, etc.

let loaderObject;
let introAnimationActive = false;
let introAnimationStartTime;
const clock = new THREE.Clock();


// --- Picsum Image URL Fetching (same as before) ---
async function fetchImageUrls(numImages, perPage = 100) {
    const imageUrls = [];
    const pagesToFetch = Math.ceil(numImages / perPage);
    updateLoadingMessage(`Fetching ${numImages} image URLs...`);
    let fetchedCount = 0;

    for (let page = 1; page <= pagesToFetch; page++) {
        if (imageUrls.length >= numImages) break;
        try {
            const response = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=${perPage}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            data.forEach(item => {
                if (imageUrls.length < numImages) {
                    const id = item.id;
                    imageUrls.push(`https://picsum.photos/id/${id}/${PICSUM_IMAGE_SIZE}/${PICSUM_IMAGE_SIZE}`);
                    fetchedCount++;
                }
            });
            updateLoadingMessage(`Fetched ${fetchedCount}/${numImages} image URLs...`);
        } catch (error) {
            console.error(`Error fetching image URLs (page ${page}):`, error);
            updateLoadingMessage(`Error fetching URLs. Will proceed with ${fetchedCount}.`);
        }
    }
    if (imageUrls.length < numImages) {
        console.warn(`Could only fetch ${imageUrls.length} out of ${numImages} requested URLs.`);
        imagesToLoadCount = imageUrls.length; // Adjust total count
    }
    return imageUrls.slice(0, numImages);
}

function updateLoadingMessage(message) {
    if (loadingMessage) {
        loadingMessage.innerHTML = message; // Use innerHTML if you might add line breaks or progress bars later
    }
}

// --- Loader ---
function createLoader() {
    const geometry = new THREE.IcosahedronGeometry(SPHERE_RADIUS * 0.3, 1); // Size relative to sphere
    const material = new THREE.MeshBasicMaterial({
        color: 0x00ffff, // Cyan
        wireframe: true,
        transparent: true,
        opacity: 0.8
    });
    loaderObject = new THREE.Mesh(geometry, material);
    scene.add(loaderObject);
}

function animateLoader(deltaTime) {
    if (loaderObject) {
        loaderObject.rotation.x += 0.5 * deltaTime;
        loaderObject.rotation.y += 0.7 * deltaTime;
        // Simple pulsation for opacity
        loaderObject.material.opacity = 0.6 + Math.sin(clock.getElapsedTime() * 3) * 0.2;
    }
}

// --- Three.js Initialization ---
function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = SPHERE_RADIUS * 2.2; // Start a bit further for intro
    camera.position.y = SPHERE_RADIUS * 0.1;
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = SPHERE_RADIUS * 0.8;
    controls.maxDistance = SPHERE_RADIUS * 5;
    controls.enabled = false; // Disabled until intro animation finishes

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    window.addEventListener('resize', onWindowResize, false);
    createLoader();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Create Image Planes and Setup Animation Data ---
function setupImagePlanes(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) {
        updateLoadingMessage("No image URLs to process.");
        if(loaderObject) scene.remove(loaderObject); // Remove loader if no images
        loadingMessage.style.display = 'none';
        controls.enabled = true;
        return;
    }
    imagesToLoadCount = imageUrls.length;
    updateLoadingMessage(`Loading textures (0/${imagesToLoadCount})... 0%`);

    const planeGeom = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);

    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const angleIncrement = Math.PI * 2 * goldenRatio;

    imageUrls.forEach((url, i) => {
        const targetPos = new THREE.Vector3();
        const t = i / (imageUrls.length > 1 ? imageUrls.length - 1 : 1);
        const inclination = Math.acos(1 - 2 * t);
        const azimuth = angleIncrement * i;

        targetPos.set(
            SPHERE_RADIUS * Math.sin(inclination) * Math.cos(azimuth),
            SPHERE_RADIUS * Math.sin(inclination) * Math.sin(azimuth),
            SPHERE_RADIUS * Math.cos(inclination)
        );

        // Random start position (further out)
        const startRadius = SPHERE_RADIUS * (2.5 + Math.random() * 1.5); // Between 2.5x and 4x radius
        const startPos = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        ).normalize().multiplyScalar(startRadius);


        // Control points for Bezier curve
        // Place control points somewhere "between" start and end, but offset for curvature
        const midPoint = new THREE.Vector3().addVectors(startPos, targetPos).multiplyScalar(0.5);
        const direction = new THREE.Vector3().subVectors(targetPos, startPos).normalize();
        const perpendicular = new THREE.Vector3(direction.y, -direction.x, 0).normalize(); // Simple perpendicular
        if (perpendicular.lengthSq() === 0) perpendicular.set(0, direction.z, -direction.y).normalize(); // Handle edge case
        if (perpendicular.lengthSq() === 0) perpendicular.set(1,0,0); // fallback

        const controlPointOffset = SPHERE_RADIUS * (0.5 + Math.random()); // How "wide" the curve is

        const cp1 = new THREE.Vector3().addVectors(midPoint, perpendicular.clone().multiplyScalar(controlPointOffset * (Math.random() > 0.5 ? 1 : -1) ));
        // Offset cp1 from start->target line slightly
        cp1.add(new THREE.Vector3(
            (Math.random() -0.5) * SPHERE_RADIUS * 0.5,
            (Math.random() -0.5) * SPHERE_RADIUS * 0.5,
            (Math.random() -0.5) * SPHERE_RADIUS * 0.5
        ));

        const cp2 = new THREE.Vector3().addVectors(midPoint, perpendicular.clone().multiplyScalar(-controlPointOffset * (Math.random() > 0.5 ? 1 : -1) ));
         // Offset cp2 from start->target line slightly
        cp2.add(new THREE.Vector3(
            (Math.random() -0.5) * SPHERE_RADIUS * 0.5,
            (Math.random() -0.5) * SPHERE_RADIUS * 0.5,
            (Math.random() -0.5) * SPHERE_RADIUS * 0.5
        ));


        const curve = new THREE.CubicBezierCurve3(startPos, cp1, cp2, targetPos);

        textureLoader.load(
            url,
            (texture) => {
                const material = new THREE.MeshStandardMaterial({
                    map: texture,
                    side: THREE.DoubleSide,
                    roughness: 0.7,
                    metalness: 0.2,
                    transparent: true,
                    opacity: 0
                });
                const planeMesh = new THREE.Mesh(planeGeom, material);
                planeMesh.position.copy(startPos); // Start at the beginning of the curve
                planeMesh.visible = false; // Initially invisible

                imagePlanesData.push({
                    mesh: planeMesh,
                    curve: curve,
                    targetPosition: targetPos.clone(), // Store for final orientation
                    animationDelay: Math.random() * INTRO_ANIM_STAGGER, // Stagger start time
                    animationProgress: 0, // 0 to 1
                    hasStartedAnimating: false
                });
                scene.add(planeMesh); // Add to scene but invisible

                imagesLoadedCount++;
                const percent = Math.round((imagesLoadedCount / imagesToLoadCount) * 100);
                updateLoadingMessage(`Loading textures (${imagesLoadedCount}/${imagesToLoadCount})... ${percent}%`);

                if (imagesLoadedCount === imagesToLoadCount) {
                    startIntroAnimation();
                }
            },
            undefined,
            (err) => {
                console.error(`Error loading texture: ${url}`, err);
                imagesLoadedCount++;
                const percent = Math.round((imagesLoadedCount / imagesToLoadCount) * 100);
                updateLoadingMessage(`Loading textures (${imagesLoadedCount}/${imagesToLoadCount})... ${percent}% (some errors)`);
                if (imagesLoadedCount === imagesToLoadCount) {
                    startIntroAnimation(); // Still start animation even if some images fail
                }
            }
        );
    });
}

function startIntroAnimation() {
    if (loaderObject) {
        scene.remove(loaderObject);
        loaderObject.geometry.dispose();
        loaderObject.material.dispose();
        loaderObject = null;
    }
    loadingMessage.style.display = 'none';
    introAnimationActive = true;
    introAnimationStartTime = clock.getElapsedTime();

    imagePlanesData.forEach(data => {
        data.mesh.visible = true; // Make them visible to start animating
    });
    console.log("All textures processed. Starting intro animation.");
}

function animateIntro(currentTime) {
    let allAnimationsFinished = true;

    imagePlanesData.forEach(data => {
        if (data.animationProgress >= 1) return; // Already finished this one

        allAnimationsFinished = false; // At least one is still animating

        const elapsedTimeSinceAnimStart = (currentTime - introAnimationStartTime) * 1000; // in ms

        if (elapsedTimeSinceAnimStart >= data.animationDelay) {
            if (!data.hasStartedAnimating) {
                data.hasStartedAnimating = true;
                // Adjust progress start time to be relative to when THIS item actually starts
                data.trueAnimStartTime = currentTime;
            }
            
            // Calculate progress for this specific item
            // Current time - (overall anim start time + this item's delay) / total duration
            const itemElapsedTime = (currentTime - (introAnimationStartTime + data.animationDelay / 1000)) * 1000;

            let t = Math.min(itemElapsedTime / INTRO_ANIM_DURATION, 1);
            
            // Apply easing function (e.g., easeInOutQuad)
            t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            
            data.animationProgress = t;

            if (t >= 0 && t <=1) { // ensure t is valid for curve.getPointAt
                data.mesh.position.copy(data.curve.getPointAt(t));
                data.mesh.material.opacity = t; // Fade in
                data.mesh.lookAt(scene.position); // Keep looking at center as it moves
            }


            if (t >= 1) {
                data.mesh.position.copy(data.targetPosition); // Ensure final position
                data.mesh.material.opacity = 1;
                data.mesh.lookAt(scene.position); // Ensure final orientation
            }
        }
    });

    if (allAnimationsFinished) {
        introAnimationActive = false;
        controls.enabled = true; // Enable controls after animation
        console.log("Intro animation finished.");
    }
}


// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const currentTime = clock.getElapsedTime();

    if (loaderObject) {
        animateLoader(deltaTime);
    }

    if (introAnimationActive) {
        animateIntro(currentTime);
    }

    if (controls.enabled) { // Only update controls if they are active
        controls.update();
    }

    renderer.render(scene, camera);
}

// --- Main Execution ---
async function main() {
    initThreeJS();
    updateLoadingMessage("Fetching image URLs...");
    const imageUrls = await fetchImageUrls(NUM_IMAGES);

    if (imageUrls && imageUrls.length > 0) {
        setupImagePlanes(imageUrls);
    } else {
        updateLoadingMessage('Failed to get image URLs. Cannot create sphere.');
        if (loaderObject) scene.remove(loaderObject); // Clean up loader
        loadingMessage.style.display = 'none'; // Hide loading message if no images
        controls.enabled = true; // Enable controls if nothing to load
        return;
    }
    animate();
}

main();
