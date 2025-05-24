import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const NUM_IMAGES = 1000; // Keep lower for easier testing initially
const PICSUM_IMAGE_SIZE = 150;
const PICSUM_HIGH_RES_SIZE = 800;
const SPHERE_RADIUS = 10;
const PLANE_SIZE = 1;

const INTRO_ANIM_DURATION = 2000;
const INTRO_ANIM_STAGGER = 1000;
const MODAL_ANIM_DURATION = 500; // For low-res plane movement
const EXTENDED_TRANSITION_DURATION = 2000; // For high-res overlay fade IN
const MODAL_CLOSE_FADE_DURATION = 300; // NEW: For high-res overlay fade OUT on close

let scene, camera, renderer, controls, raycaster;
const textureLoader = new THREE.TextureLoader();
const loadingMessage = document.getElementById('loading-message');
const mouse = new THREE.Vector2();

let imagesToLoadCount = NUM_IMAGES;
let imagesLoadedCount = 0;

const imagePlanesData = [];

let loaderObject;
let introAnimationActive = false;
let introAnimationStartTime;
const clock = new THREE.Clock();

// Drag vs Click detection
let mouseDownStartPos = { x: 0, y: 0 };
let isPotentiallyDragging = false;
let hasDragged = false;
const DRAG_THRESHOLD = 5;

// Modal state
let isModalOpen = false;
let activeModalPlane = null; // The low-res plane from the sphere
let highResOverlayPlane = null; // The plane for the high-res image overlay
let isLoadingHighRes = false;
let loadingIndicatorPlane = null; // For "Loading High-Res Asset..." text

let originalSphereState = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    opacity: 1
};
let sphereOverlay; // For dimming the background

// --- Image URL Fetching ---
async function fetchImageUrls(numImages, perPage = 100) {
    const imageUrlsData = [];
    const pagesToFetch = Math.ceil(numImages / perPage);
    updateLoadingMessage(`Fetching ${numImages} image URLs...`);
    let fetchedCount = 0;

    for (let page = 1; page <= pagesToFetch; page++) {
        if (imageUrlsData.length >= numImages) break;
        try {
            const response = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=${perPage}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            data.forEach(item => {
                if (imageUrlsData.length < numImages) {
                    const id = item.id;
                    imageUrlsData.push({
                        id: id,
                        lowResUrl: `https://picsum.photos/id/${id}/${PICSUM_IMAGE_SIZE}/${PICSUM_IMAGE_SIZE}`,
                        highResUrl: `https://picsum.photos/id/${id}/${PICSUM_HIGH_RES_SIZE}/${PICSUM_HIGH_RES_SIZE}`
                    });
                    fetchedCount++;
                }
            });
            updateLoadingMessage(`Fetched ${fetchedCount}/${numImages} image URLs...`);
        } catch (error) {
            console.error(`Error fetching image URLs (page ${page}):`, error);
            updateLoadingMessage(`Error fetching URLs. Will proceed with ${fetchedCount}.`);
        }
    }
    if (imageUrlsData.length < numImages) {
        console.warn(`Could only fetch ${imageUrlsData.length} out of ${numImages} requested URLs.`);
        imagesToLoadCount = imageUrlsData.length;
    }
    return imageUrlsData.slice(0, numImages);
}

function updateLoadingMessage(message) {
    if (loadingMessage) loadingMessage.innerHTML = message;
}

// --- Loader ---
function createLoader() {
    const geometry = new THREE.IcosahedronGeometry(SPHERE_RADIUS * 0.3, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.8 });
    loaderObject = new THREE.Mesh(geometry, material);
    scene.add(loaderObject);
}
function animateLoader(deltaTime) {
    if (loaderObject) {
        loaderObject.rotation.x += 0.5 * deltaTime;
        loaderObject.rotation.y += 0.7 * deltaTime;
        loaderObject.material.opacity = 0.6 + Math.sin(clock.getElapsedTime() * 3) * 0.2;
    }
}

// --- Three.js Initialization ---
function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = SPHERE_RADIUS * 2.2;
    camera.position.y = SPHERE_RADIUS * 0.1;
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Event listeners for drag vs click and modal interaction
    renderer.domElement.addEventListener('mousedown', onCanvasMouseDown, false);
    renderer.domElement.addEventListener('mousemove', onCanvasMouseMove, false);
    renderer.domElement.addEventListener('mouseup', onCanvasMouseUp, false);
    renderer.domElement.addEventListener('click', onCanvasClick, false); // Primary click handler

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = SPHERE_RADIUS * 0.8;
    controls.maxDistance = SPHERE_RADIUS * 5;
    controls.enabled = false; // Initially disabled

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    raycaster = new THREE.Raycaster();

    // Sphere overlay for dimming background
    const overlayGeometry = new THREE.SphereGeometry(SPHERE_RADIUS * 3, 32, 32); // Ensure it's large enough
    const overlayMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        depthWrite: false
    });
    sphereOverlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
    sphereOverlay.visible = false;
    sphereOverlay.renderOrder = 998;
    scene.add(sphereOverlay);

    window.addEventListener('resize', onWindowResize, false);
    createLoader();
}

// --- Drag vs Click Event Handlers ---
function onCanvasMouseDown(event) {
    if (isModalOpen) return;
    isPotentiallyDragging = true;
    hasDragged = false;
    mouseDownStartPos.x = event.clientX;
    mouseDownStartPos.y = event.clientY;
}

function onCanvasMouseMove(event) {
    if (isModalOpen || !isPotentiallyDragging) return;
    const deltaX = Math.abs(event.clientX - mouseDownStartPos.x);
    const deltaY = Math.abs(event.clientY - mouseDownStartPos.y);
    if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        hasDragged = true;
    }
}

function onCanvasMouseUp(event) {
    if (isModalOpen) return;
    isPotentiallyDragging = false;
}

// --- Main Click Handler ---
function onCanvasClick(event) {
    if (introAnimationActive) return;

    if (hasDragged) {
        hasDragged = false;
        return;
    }
    hasDragged = false;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (isModalOpen) {
        let clickedToClose = false;
        if (highResOverlayPlane && highResOverlayPlane.visible && highResOverlayPlane.material.opacity > 0.1) {
            const intersectsHighRes = raycaster.intersectObject(highResOverlayPlane, false);
            if (intersectsHighRes.length > 0) {
                closeModal();
                clickedToClose = true;
            }
        }
        if (!clickedToClose && activeModalPlane) {
            const intersectsLowRes = raycaster.intersectObject(activeModalPlane, false);
            if (intersectsLowRes.length > 0) {
                closeModal();
            }
        }
        return;
    }

    const spherePlanesMeshes = imagePlanesData.map(d => d.mesh);
    const intersects = raycaster.intersectObjects(spherePlanesMeshes);
    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        if (clickedObject.userData.isSpherePlane) {
            openModal(clickedObject);
        }
    }
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Image Planes Setup ---
function setupImagePlanes(urlsData) {
    if (!urlsData || urlsData.length === 0) {
        updateLoadingMessage("No image URLs to process.");
        if(loaderObject) scene.remove(loaderObject);
        loadingMessage.style.display = 'none';
        controls.enabled = true;
        return;
    }
    imagesToLoadCount = urlsData.length;
    updateLoadingMessage(`Loading textures (0/${imagesToLoadCount})... 0%`);

    const planeGeom = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const angleIncrement = Math.PI * 2 * goldenRatio;

    urlsData.forEach((data, i) => {
        const targetPos = new THREE.Vector3();
        const tPosCalc = i / (urlsData.length > 1 ? urlsData.length - 1 : 1);
        const inclination = Math.acos(1 - 2 * tPosCalc);
        const azimuth = angleIncrement * i;
        targetPos.set(
            SPHERE_RADIUS * Math.sin(inclination) * Math.cos(azimuth),
            SPHERE_RADIUS * Math.sin(inclination) * Math.sin(azimuth),
            SPHERE_RADIUS * Math.cos(inclination)
        );

        const startPos = new THREE.Vector3().randomDirection().multiplyScalar(SPHERE_RADIUS * (2.5 + Math.random() * 1.5));
        const midPoint = new THREE.Vector3().addVectors(startPos, targetPos).multiplyScalar(0.5);
        const direction = new THREE.Vector3().subVectors(targetPos, startPos).normalize();
        let perpendicular = new THREE.Vector3(direction.y, -direction.x, 0).normalize();
        if (perpendicular.lengthSq() < 0.001) perpendicular.set(0, direction.z, -direction.y).normalize();
        if (perpendicular.lengthSq() < 0.001) perpendicular.set(1,0,0);
        const controlPointOffset = SPHERE_RADIUS * (0.5 + Math.random());
        const cp1 = new THREE.Vector3().addVectors(midPoint, perpendicular.clone().multiplyScalar(controlPointOffset * (Math.random() > 0.5 ? 1 : -1)))
            .add(new THREE.Vector3().randomDirection().multiplyScalar(SPHERE_RADIUS * 0.2));
        const cp2 = new THREE.Vector3().addVectors(midPoint, perpendicular.clone().multiplyScalar(-controlPointOffset * (Math.random() > 0.5 ? 1 : -1)))
            .add(new THREE.Vector3().randomDirection().multiplyScalar(SPHERE_RADIUS * 0.2));
        const curve = new THREE.CubicBezierCurve3(startPos, cp1, cp2, targetPos);

        textureLoader.load( data.lowResUrl, (texture) => {
                const material = new THREE.MeshStandardMaterial({
                    map: texture, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.2,
                    transparent: true, opacity: 0
                });
                const planeMesh = new THREE.Mesh(planeGeom, material);
                planeMesh.position.copy(startPos);
                planeMesh.visible = false;
                planeMesh.userData = {
                    picsumId: data.id, lowResUrl: data.lowResUrl, highResUrl: data.highResUrl,
                    isSpherePlane: true
                };
                imagePlanesData.push({
                    mesh: planeMesh, curve: curve, targetPosition: targetPos.clone(),
                    animationDelay: Math.random() * INTRO_ANIM_STAGGER,
                    animationProgress: 0, hasStartedAnimating: false
                });
                scene.add(planeMesh);
                imagesLoadedCount++;
                const percent = Math.round((imagesLoadedCount / imagesToLoadCount) * 100);
                updateLoadingMessage(`Loading textures (${imagesLoadedCount}/${imagesToLoadCount})... ${percent}%`);
                if (imagesLoadedCount === imagesToLoadCount) startIntroAnimation();
            },
            undefined, (err) => {
                console.error(`Error loading texture: ${data.lowResUrl}`, err);
                imagesLoadedCount++;
                if (imagesLoadedCount === imagesToLoadCount) startIntroAnimation();
            }
        );
    });
}

// --- Intro Animation ---
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
    imagePlanesData.forEach(data => data.mesh.visible = true);
    console.log("All textures processed. Starting intro animation.");
}
function animateIntro(currentTime) {
    let allAnimationsFinished = true;
    imagePlanesData.forEach(data => {
        if (data.animationProgress >= 1) return;
        allAnimationsFinished = false;
        const elapsedTimeSinceAnimStart = (currentTime - introAnimationStartTime) * 1000;
        if (elapsedTimeSinceAnimStart >= data.animationDelay) {
            if (!data.hasStartedAnimating) {
                data.hasStartedAnimating = true;
                data.trueAnimStartTime = currentTime;
            }
            const itemElapsedTime = (currentTime - (introAnimationStartTime + data.animationDelay / 1000)) * 1000;
            let t = Math.min(itemElapsedTime / INTRO_ANIM_DURATION, 1);
            t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
            data.animationProgress = t;
            if (t >= 0 && t <= 1) {
                data.mesh.position.copy(data.curve.getPointAt(t));
                data.mesh.material.opacity = t;
                data.mesh.lookAt(scene.position);
            }
            if (t >= 1) {
                data.mesh.position.copy(data.targetPosition);
                data.mesh.material.opacity = 1;
                data.mesh.lookAt(scene.position);
            }
        }
    });
    if (allAnimationsFinished && introAnimationActive) {
        introAnimationActive = false;
        controls.enabled = true;
        console.log("Intro animation finished.");
    }
}

// --- Modal Logic ---
function openModal(spherePlane) {
    if (isModalOpen) return;
    isModalOpen = true;
    activeModalPlane = spherePlane;
    controls.enabled = false;

    originalSphereState.position.copy(activeModalPlane.position);
    originalSphereState.quaternion.copy(activeModalPlane.quaternion);
    originalSphereState.scale.copy(activeModalPlane.scale);
    originalSphereState.opacity = activeModalPlane.material.opacity;

    sphereOverlay.visible = true;
    sphereOverlay.material.opacity = 0;
    animateValue(sphereOverlay.material, 'opacity', 0.7, MODAL_ANIM_DURATION * 0.8);

    // Modal Sizing Logic
    const cameraDistance = activeModalPlane.position.distanceTo(camera.position);
    const modalDepth = Math.min(cameraDistance * 0.6, SPHERE_RADIUS * 0.8);
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const viewHeightAtModalDepth = 2 * Math.tan(vFOV / 2) * modalDepth;
    const viewWidthAtModalDepth = viewHeightAtModalDepth * camera.aspect;
    const maxVisualWidth = viewWidthAtModalDepth * 0.8;
    const maxVisualHeight = viewHeightAtModalDepth * 0.8;
    let imageAspect = 1;
    if (activeModalPlane.material.map && activeModalPlane.material.map.image) {
        const img = activeModalPlane.material.map.image;
        if (img.naturalWidth && img.naturalHeight && img.naturalHeight > 0) {
            imageAspect = img.naturalWidth / img.naturalHeight;
        }
    }
    let finalModalWidth, finalModalHeight;
    if (maxVisualWidth / imageAspect <= maxVisualHeight) {
        finalModalWidth = maxVisualWidth;
        finalModalHeight = finalModalWidth / imageAspect;
    } else {
        finalModalHeight = maxVisualHeight;
        finalModalWidth = finalModalHeight * imageAspect;
    }
    const modalTargetScaleFactorX = finalModalWidth / PLANE_SIZE;
    const modalTargetScaleFactorY = finalModalHeight / PLANE_SIZE;

    const modalTargetPosVec = new THREE.Vector3(0, 0, -modalDepth);
    const worldTargetPos = camera.localToWorld(modalTargetPosVec.clone());
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(camera.matrixWorld);

    const startPos = activeModalPlane.position.clone();
    const startQuaternion = activeModalPlane.quaternion.clone();
    const startScale = activeModalPlane.scale.clone();
    const endScale = new THREE.Vector3(modalTargetScaleFactorX, modalTargetScaleFactorY, 1);

    activeModalPlane.material.opacity = 1;
    activeModalPlane.visible = true;
    activeModalPlane.renderOrder = 999;

    let startTime = clock.getElapsedTime();
    function tweenModalOpen() {
        const elapsedTime = (clock.getElapsedTime() - startTime) * 1000;
        let t = Math.min(elapsedTime / MODAL_ANIM_DURATION, 1);
        t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        activeModalPlane.position.lerpVectors(startPos, worldTargetPos, t);
        activeModalPlane.quaternion.copy(startQuaternion).slerp(targetQuaternion, t);
        activeModalPlane.scale.lerpVectors(startScale, endScale, t);

        if (t < 1) {
            requestAnimationFrame(tweenModalOpen);
        } else {
            activeModalPlane.position.copy(worldTargetPos);
            activeModalPlane.quaternion.copy(targetQuaternion);
            activeModalPlane.scale.copy(endScale);
            showHighResOverlayOnTopOf(activeModalPlane);
        }
    }
    tweenModalOpen();
}

function showHighResOverlayOnTopOf(lowResPlane) {
    if (!highResOverlayPlane) {
        const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
        const material = new THREE.MeshStandardMaterial({
            transparent: true, opacity: 0, side: THREE.DoubleSide,
            roughness: 0.7, metalness: 0.2, depthWrite: false
        });
        highResOverlayPlane = new THREE.Mesh(geometry, material);
        highResOverlayPlane.name = "highResOverlayPlane";
        highResOverlayPlane.renderOrder = 1000;
        scene.add(highResOverlayPlane);
    }

    highResOverlayPlane.position.copy(lowResPlane.position);
    highResOverlayPlane.quaternion.copy(lowResPlane.quaternion);
    highResOverlayPlane.scale.copy(lowResPlane.scale);
    const offsetVector = new THREE.Vector3(0, 0, 0.001);
    offsetVector.applyQuaternion(lowResPlane.quaternion);
    highResOverlayPlane.position.add(offsetVector);

    if (highResOverlayPlane.material.map && highResOverlayPlane.material.map.dispose) {
         highResOverlayPlane.material.map.dispose();
    }
    highResOverlayPlane.material.map = null;
    highResOverlayPlane.material.opacity = 0;
    highResOverlayPlane.visible = true;
    isLoadingHighRes = true;

    showLoadingIndicator(highResOverlayPlane, "Loading High-Res Asset...");
    updateLoadingMessage("Loading high-res image...");

    textureLoader.load( lowResPlane.userData.highResUrl, (highResTexture) => {
            isLoadingHighRes = false;
            hideLoadingIndicator();
            updateLoadingMessage("");
            if (highResOverlayPlane && highResOverlayPlane.material && isModalOpen) {
                highResOverlayPlane.material.map = highResTexture;
                highResOverlayPlane.material.needsUpdate = true;
                animateValue(highResOverlayPlane.material, 'opacity', 1, EXTENDED_TRANSITION_DURATION);
            } else if (highResTexture.dispose) {
                 highResTexture.dispose();
            }
        },
        undefined, (err) => {
            isLoadingHighRes = false;
            hideLoadingIndicator();
            console.error("Error loading high-res texture:", err);
            updateLoadingMessage("Error loading high-res.");
            if (highResOverlayPlane) highResOverlayPlane.visible = false;
        }
    );
}

function closeModal() {
    if (!isModalOpen) return;

    if (isLoadingHighRes) isLoadingHighRes = false;
    hideLoadingIndicator();
    updateLoadingMessage("Closing...");

    animateValue(sphereOverlay.material, 'opacity', 0, MODAL_ANIM_DURATION * 0.8, () => {
        sphereOverlay.visible = false;
    });

    function animateLowResPlaneBack() {
        if (!activeModalPlane) return;
        activeModalPlane.material.opacity = 1;
        activeModalPlane.renderOrder = 0;

        const targetPos = originalSphereState.position;
        const targetQuaternion = originalSphereState.quaternion;
        const targetScale = originalSphereState.scale;
        const targetOpacity = originalSphereState.opacity;

        const startPos = activeModalPlane.position.clone();
        const startQuaternion = activeModalPlane.quaternion.clone();
        const startScale = activeModalPlane.scale.clone();

        let startTime = clock.getElapsedTime();
        function tweenCloseLowRes() {
            const elapsedTime = (clock.getElapsedTime() - startTime) * 1000;
            let t = Math.min(elapsedTime / MODAL_ANIM_DURATION, 1);
            t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            activeModalPlane.position.lerpVectors(startPos, targetPos, t);
            activeModalPlane.quaternion.copy(startQuaternion).slerp(targetQuaternion, t);
            activeModalPlane.scale.lerpVectors(startScale, targetScale, t);

            if (t < 1) {
                requestAnimationFrame(tweenCloseLowRes);
            } else {
                activeModalPlane.position.copy(targetPos);
                activeModalPlane.quaternion.copy(targetQuaternion);
                activeModalPlane.scale.copy(targetScale);
                activeModalPlane.material.opacity = targetOpacity;

                isModalOpen = false;
                activeModalPlane = null;
                controls.enabled = true;
                updateLoadingMessage("");
            }
        }
        tweenCloseLowRes();
    }

    if (highResOverlayPlane && highResOverlayPlane.visible && highResOverlayPlane.material.opacity > 0) {
        // Use MODAL_CLOSE_FADE_DURATION for a quicker fade out
        animateValue(highResOverlayPlane.material, 'opacity', 0, MODAL_CLOSE_FADE_DURATION, () => {
            if (highResOverlayPlane) {
                highResOverlayPlane.visible = false;
                if (highResOverlayPlane.material.map) {
                    highResOverlayPlane.material.map.dispose();
                    highResOverlayPlane.material.map = null;
                }
            }
            animateLowResPlaneBack();
        });
    } else {
        if (highResOverlayPlane) highResOverlayPlane.visible = false;
        animateLowResPlaneBack();
    }
}

// --- Loading Indicator Helpers ---
function createLoadingIndicatorTextTexture(text, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, width, height);
    context.font = `${Math.min(height * 0.3, 28)}px Arial`;
    context.fillStyle = 'white';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2);
    return new THREE.CanvasTexture(canvas);
}

function showLoadingIndicator(parentPlane, text) {
    if (!loadingIndicatorPlane) {
        const indicatorWidth = PLANE_SIZE * 0.7;
        const indicatorHeight = PLANE_SIZE * 0.15;
        const geometry = new THREE.PlaneGeometry(indicatorWidth, indicatorHeight);
        const material = new THREE.MeshBasicMaterial({
            transparent: true, opacity: 0.9, depthTest: false, depthWrite: false
        });
        loadingIndicatorPlane = new THREE.Mesh(geometry, material);
        loadingIndicatorPlane.name = "loadingIndicator";
        loadingIndicatorPlane.position.z = 0.002; // Ensure on top of its parent
        loadingIndicatorPlane.renderOrder = 1001;
    }
    const textureWidth = 512; const textureHeight = 128;
    if (loadingIndicatorPlane.material.map) loadingIndicatorPlane.material.map.dispose();
    loadingIndicatorPlane.material.map = createLoadingIndicatorTextTexture(text, textureWidth, textureHeight);
    loadingIndicatorPlane.material.needsUpdate = true;
    if (loadingIndicatorPlane.parent !== parentPlane) parentPlane.add(loadingIndicatorPlane);
    loadingIndicatorPlane.visible = true;
}
function hideLoadingIndicator() {
    if (loadingIndicatorPlane) {
        loadingIndicatorPlane.visible = false;
        if (loadingIndicatorPlane.material.map) {
            loadingIndicatorPlane.material.map.dispose();
            loadingIndicatorPlane.material.map = null;
        }
        if(loadingIndicatorPlane.parent) {
            loadingIndicatorPlane.parent.remove(loadingIndicatorPlane);
        }
    }
}

// --- General Animation Helper ---
function animateValue(target, property, toValue, duration, onComplete) {
    const fromValue = target[property];
    const startTime = clock.getElapsedTime();
    function update() {
        const elapsedTime = (clock.getElapsedTime() - startTime) * 1000;
        let t = Math.min(elapsedTime / duration, 1);
        t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
        target[property] = fromValue + (toValue - fromValue) * t;
        if (t < 1) {
            requestAnimationFrame(update);
        } else {
            target[property] = toValue;
            if (onComplete) onComplete();
        }
    }
    update();
}

// --- Main Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const currentTime = clock.getElapsedTime();

    if (loaderObject) animateLoader(deltaTime);
    if (introAnimationActive) animateIntro(currentTime);
    if (controls.enabled) controls.update();

    renderer.render(scene, camera);
}

// --- Main Execution ---
async function main() {
    initThreeJS();
    const urlsData = await fetchImageUrls(NUM_IMAGES);
    if (urlsData && urlsData.length > 0) {
        setupImagePlanes(urlsData);
    } else {
        updateLoadingMessage('Failed to get image URLs. Cannot create sphere.');
        if (loaderObject) scene.remove(loaderObject);
        loadingMessage.style.display = 'none';
        controls.enabled = true;
    }
    animate();
}

main();