let isAppLoading = true;

// Elements
const workspaceContainer = document.getElementById('workspace-container');
const workspace = document.getElementById('workspace');
const nodesLayer = document.getElementById('nodes-layer');

// Pan & Zoom State
let panX = 0;
let panY = 0;
let zoom = 1;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

function updateWorkspace() {
    workspace.style.transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`;
    // Update Parallax space effect implicitly through requestAnimationFrame
}

// Panning Logic
workspaceContainer.addEventListener('mousedown', (e) => {
    // Only pan if clicking on empty space
    if (e.target !== workspaceContainer && e.target !== workspace && e.target.id !== 'space-canvas') return;
    if (e.button !== 0 && e.button !== 1) return; // Left or middle click
    
    isPanning = true;
    startPanX = e.clientX / zoom - panX;
    startPanY = e.clientY / zoom - panY;
    workspaceContainer.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        panX = e.clientX / zoom - startPanX;
        panY = e.clientY / zoom - startPanY;
        updateWorkspace();
    }
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        workspaceContainer.style.cursor = 'grab';
        saveData();
    }
});

// Zooming Logic
workspaceContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    
    // Zoom around mouse cursor
    const rect = workspaceContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width/2;
    const mouseY = e.clientY - rect.top - rect.height/2;

    const oldZoom = zoom;
    zoom = Math.max(0.1, Math.min(5, zoom * Math.exp(delta)));

    // Adjust pan to keep cursor fixed
    panX += mouseX / zoom - mouseX / oldZoom;
    panY += mouseY / zoom - mouseY / oldZoom;
    
    updateWorkspace();
    saveData();
}, { passive: false });


// Node Management State
let nodes = [];
let nodeCounter = 0;

// Create a new idea node
function createNode(x, y, data = {}) {
    nodeCounter++;
    const id = 'node-' + nodeCounter;
    
    const el = document.createElement('div');
    el.className = 'node';
    el.id = id;
    el.style.margin = '0'; // Force override cached CSS
    
    // Position (0,0 is screen center)
    x = x || 0;
    y = y || 0;

    const hasLink = data.link && data.link.trim() !== '';
    const dateType = data.date ? 'date' : 'text';
    const timeType = data.time ? 'time' : 'text';

    el.innerHTML = `
        <div class="node-header">
            <div class="drag-handle" title="اسحب من هنا لتريك الفكرة"><i class="fas fa-grip-vertical"></i></div>
            <input type="text" class="node-title" placeholder="عنوان الفكرة..." value="${data.title || ''}">
            <div class="node-actions">
                <button class="delete-btn"><i class="fas fa-times"></i></button>
            </div>
        </div>
        <div class="node-content">
            <div class="node-image-container">
                <div class="upload-placeholder" style="${data.imageSrc ? 'display:none;' : ''}">
                    <i class="fas fa-image"></i>
                    <span>لصق (Ctrl+V) أو انقر لرفع صورة</span>
                </div>
                <img src="${data.imageSrc || ''}" style="${data.imageSrc ? 'display:block;' : ''}">
                <input type="file" style="display:none;" accept="image/*">
            </div>
            
            <!-- 1. Description -->
            <textarea class="node-notes" placeholder="اكتب الوصف والملاحظات هنا...">${data.notes || ''}</textarea>
            
            <!-- 2. Link -->
            <div class="link-wrapper">
                <div class="link-display" style="${hasLink ? '' : 'display:none;'}">
                    <a href="${hasLink ? data.link : '#'}" target="_blank">
                        <i class="fas fa-rocket"></i> <span class="link-text">فتح الرابط</span>
                    </a>
                    <button class="edit-link-btn" title="تعديل الرابط"><i class="fas fa-pen"></i></button>
                </div>
                <div class="link-edit" style="${hasLink ? 'display:none;' : ''}">
                    <input type="url" class="node-link-input" placeholder="ألصق الرابط هنا (URL)..." value="${data.link || ''}">
                    <button class="save-link-btn"><i class="fas fa-check"></i></button>
                </div>
            </div>
            
            <!-- 3. Date & Time -->
            <div class="node-date-wrapper">
                <div class="date-icon"><i class="fas fa-calendar-alt"></i></div>
                <input type="${dateType}" class="node-date" value="${data.date || ''}" title="تاريخ المهمة" placeholder="التاريخ" onfocus="(this.type='date')" onblur="if(!this.value)this.type='text'">
                <input type="${timeType}" class="node-time" value="${data.time || ''}" title="وقت المهمة" placeholder="الوقت" onfocus="(this.type='time')" onblur="if(!this.value)this.type='text'">
            </div>
            
        </div>
    `;
    
    nodesLayer.appendChild(el);

    const nodeObj = { id, el, x, y, data };
    nodes.push(nodeObj);
    
    updateNodePosition(nodeObj);
    setupNodeInteractions(nodeObj);
    
    saveData();
    return nodeObj;
}

function updateNodePosition(nodeObj) {
    nodeObj.el.style.transform = `translate(${nodeObj.x}px, ${nodeObj.y}px)`;
}

function setupNodeInteractions(nodeObj) {
    const el = nodeObj.el;
    
    // Dragging
    let isDragging = false;
    let startX, startY, initialNodeX, initialNodeY;

    el.querySelector('.drag-handle').addEventListener('mousedown', (e) => {
        isDragging = true;
        el.classList.add('dragging');
        startX = e.clientX;
        startY = e.clientY;
        initialNodeX = nodeObj.x;
        initialNodeY = nodeObj.y;
        
        // Bring to front inside nodes layer
        nodesLayer.appendChild(el);
        e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;
        nodeObj.x = initialNodeX + dx;
        nodeObj.y = initialNodeY + dy;
        updateNodePosition(nodeObj);
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            el.classList.remove('dragging');
            saveData();
        }
    });

    // Delete
    el.querySelector('.delete-btn').addEventListener('click', () => {
        nodes = nodes.filter(n => n !== nodeObj);
        el.remove();
        saveData();
    });

    // Image Upload
    const imgContainer = el.querySelector('.node-image-container');
    const fileInput = el.querySelector('input[type="file"]');
    const img = el.querySelector('img');
    const placeholder = el.querySelector('.upload-placeholder');

    placeholder.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = e => {
                img.src = e.target.result;
                img.style.display = 'block';
                placeholder.style.display = 'none';
                nodeObj.data.imageSrc = e.target.result;
                saveData();
            }
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    // Link UI Logic
    const linkDisplay = el.querySelector('.link-display');
    const linkEdit = el.querySelector('.link-edit');
    const linkInput = el.querySelector('.node-link-input');
    const saveLinkBtn = el.querySelector('.save-link-btn');
    const editLinkBtn = el.querySelector('.edit-link-btn');
    const linkAnchor = el.querySelector('.link-display a');

    function saveLink() {
        const url = linkInput.value.trim();
        nodeObj.data.link = url;
        saveData();
        if (url) {
            let finalUrl = url;
            if (!/^https?:\/\//i.test(url)) finalUrl = 'http://' + url;
            linkAnchor.href = finalUrl;
            linkDisplay.style.display = 'flex';
            linkEdit.style.display = 'none';
        } else {
            linkDisplay.style.display = 'none';
            linkEdit.style.display = 'flex';
        }
    }

    saveLinkBtn.addEventListener('click', saveLink);
    linkInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') saveLink(); });
    editLinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        linkDisplay.style.display = 'none';
        linkEdit.style.display = 'flex';
        linkInput.focus();
    });
    
    // Automatically show link editor if it's empty when first created, unless we just pasted
    if (!linkInput.value) {
        linkDisplay.style.display = 'none';
        linkEdit.style.display = 'flex';
    }
    
    // Auto-save on inputs
    const titleInput = el.querySelector('.node-title');
    titleInput.addEventListener('input', () => { nodeObj.data.title = titleInput.value; saveData(); });
    
    const notesInput = el.querySelector('.node-notes');
    notesInput.addEventListener('input', () => { nodeObj.data.notes = notesInput.value; saveData(); });
    
    const dateInput = el.querySelector('.node-date');
    dateInput.addEventListener('input', () => { nodeObj.data.date = dateInput.value; saveData(); });
    
    const timeInput = el.querySelector('.node-time');
    timeInput.addEventListener('input', () => { nodeObj.data.time = timeInput.value; saveData(); });
}

// Right Click to Add Node
window.addEventListener('contextmenu', (e) => {
    // Ignore if right-clicking on an existing node
    if (e.target.closest('.node')) return;
    
    e.preventDefault();
    
    const rect = workspace.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - 150; // Center node on cursor horizontally
    const y = (e.clientY - rect.top) / zoom - 50;  // Center somewhat vertically
    
    createNode(x, y);
});

// Parallax Space Canvas Background
const canvas = document.getElementById('space-canvas');
const ctx = canvas.getContext('2d');
let cw, ch;

const stars = [];
for(let i=0; i<800; i++) {
    stars.push({
        x: (Math.random() - 0.5) * 4000,
        y: (Math.random() - 0.5) * 4000,
        z: Math.random() * 2 + 0.2, // depth for parallax
        radius: Math.random() * 1.5,
        alpha: Math.random(),
        color: Math.random() > 0.8 ? '#a855f7' : (Math.random() > 0.5 ? '#3b82f6' : '#ffffff') // Purple, Blue, White
    });
}

function resizeCanvas() {
    cw = canvas.width = window.innerWidth;
    ch = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Interactive Mouse Particles
const mouseParticles = [];
class MouseParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 2 + 1;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = Math.random() * 2 - 1;
        this.life = 1.0;
        this.decay = Math.random() * 0.03 + 0.01;
        const colors = ['#00d2ff', '#a855f7', '#ec4899', '#ffffff'];
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }
    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.life -= this.decay;
    }
    draw(ctx) {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

window.addEventListener('mousemove', (e) => {
    // Generate particles around mouse position
    for(let i=0; i<2; i++) {
        mouseParticles.push(new MouseParticle(e.clientX, e.clientY));
    }
});

function drawSpace() {
    ctx.clearRect(0, 0, cw, ch);
    
    // Draw stars with parallax effect based on pan and zoom
    stars.forEach(s => {
        // Star position shifts based on its depth (z) and current pan
        let sx = (s.x + panX * s.z * 0.5) % 4000;
        let sy = (s.y + panY * s.z * 0.5) % 4000;
        
        // Wrap around logic for infinite space illusion
        if (sx > 2000) sx -= 4000;
        if (sx < -2000) sx += 4000;
        if (sy > 2000) sy -= 4000;
        if (sy < -2000) sy += 4000;
        
        // Convert to screen coords (zooming affects stars slightly for depth feel)
        const screenX = sx * Math.sqrt(zoom) + cw/2;
        const screenY = sy * Math.sqrt(zoom) + ch/2;
        
        if (screenX > 0 && screenX < cw && screenY > 0 && screenY < ch) {
            ctx.globalAlpha = s.alpha;
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, s.radius * Math.sqrt(zoom), 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Twinkle effect
        s.alpha += (Math.random() - 0.5) * 0.1;
        if (s.alpha > 1) s.alpha = 1;
        if (s.alpha < 0.2) s.alpha = 0.2;
    });
    
    // Draw mouse particles
    for (let i = 0; i < mouseParticles.length; i++) {
        mouseParticles[i].update();
        mouseParticles[i].draw(ctx);
        if (mouseParticles[i].life <= 0) {
            mouseParticles.splice(i, 1);
            i--;
        }
    }
    
    requestAnimationFrame(drawSpace);
}
drawSpace();

// Storage Logic
function saveData() {
    if (isAppLoading) return;
    
    const serializedNodes = nodes.map(n => ({
        x: n.x,
        y: n.y,
        data: n.data
    }));
    
    const state = {
        panX,
        panY,
        zoom,
        nodes: serializedNodes
    };
    
    try {
        localStorage.setItem('mindLinksData', JSON.stringify(state));
    } catch (e) {
        console.warn('Storage limit exceeded!', e);
    }
}

function loadData() {
    const saved = localStorage.getItem('mindLinksData');
    if (saved) {
        try {
            const state = JSON.parse(saved);
            panX = state.panX || 0;
            panY = state.panY || 0;
            zoom = state.zoom || 1;
            updateWorkspace();
            
            if (state.nodes && state.nodes.length > 0) {
                state.nodes.forEach(n => {
                    createNode(n.x, n.y, n.data);
                });
            } else {
                createDefaultNode();
            }
        } catch (e) {
            createDefaultNode();
        }
    } else {
        createDefaultNode();
    }
    
    isAppLoading = false;
}

function createDefaultNode() {
    createNode(-150, -100, {
        title: 'مرحباً بك في فضاء الأفكار 🚀',
        notes: 'تحرك بالماوس في الشاشة (عبر سحب المساحة الفارغة)، واستخدم عجلة الماوس للتقريب والتبعيد (Zoom).',
        link: 'https://google.com'
    });
}

loadData();

window.addEventListener('paste', (e) => {
    // Ignore if typing inside input/textarea
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let pastedText = e.clipboardData.getData('text');
    let pastedImage = null;
    
    const rect = workspace.getBoundingClientRect();
    // Paste near screen center relative to current pan/zoom
    const centerX = (window.innerWidth/2 - rect.left) / zoom - 150;
    const centerY = (window.innerHeight/2 - rect.top) / zoom - 100;

    for (let item of items) {
        if (item.kind === 'file') {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = e => {
                createNode(centerX, centerY, { imageSrc: e.target.result, notes: pastedText });
            };
            reader.readAsDataURL(blob);
            return;
        }
    }

    if (pastedText) {
        let isUrl = false;
        try { new URL(pastedText); isUrl = true; } catch (_) {}
        createNode(centerX, centerY, {
            title: isUrl ? 'رابط جديد' : 'فكرة جديدة',
            link: isUrl ? pastedText : '',
            notes: isUrl ? '' : pastedText
        });
    }
});

// Global Drag & Drop for Images
window.addEventListener('dragover', (e) => {
    e.preventDefault();
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    
    // Ignore if dropping inside a node's specific file input
    if (e.target.closest('input[type="file"]')) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const rect = workspace.getBoundingClientRect();
        // Convert mouse drop coordinates to workspace coords
        const dropX = (e.clientX - rect.left) / zoom - 150;
        const dropY = (e.clientY - rect.top) / zoom - 100;
        
        let fileProcessed = false;
        Array.from(e.dataTransfer.files).forEach((file, index) => {
            if (file.type.startsWith('image/')) {
                fileProcessed = true;
                const reader = new FileReader();
                reader.onload = (event) => {
                    createNode(dropX + (index * 20), dropY + (index * 20), { 
                        title: 'صورة جديدة',
                        imageSrc: event.target.result 
                    });
                };
                reader.readAsDataURL(file);
            }
        });
    }
});
