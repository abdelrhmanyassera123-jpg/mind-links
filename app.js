// ====== Supabase & IndexedDB Auth ======
const supabaseUrl = 'https://nkintzpwhvxkplgxfpch.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5raW50enB3aHZ4a3BsZ3hmcGNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjY0MzgsImV4cCI6MjA5Nzc0MjQzOH0.e2Fku69QTdHLNJz8Z917hbWFgKaGPMGMOS7oqbF_eCc';
let supabaseClient = null;
if (window.supabase) {
    try {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
    } catch (e) {
        console.warn('Failed to initialize Supabase client:', e);
    }
}

// ====== Image Compression ======
async function compressImage(file, maxWidth = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/webp', 0.6));
            };
        };
    });
}

const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('MindLinksDB', 1);
    request.onupgradeneeded = e => e.target.result.createObjectStore('store');
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
});
async function idbSet(key, val) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        tx.objectStore('store').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function idbGet(key) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readonly');
        const req = tx.objectStore('store').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(tx.error);
    });
}

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

// Node Management State
let nodes = [];
let nodeCounter = 0;
let saveTimeout = null;

// ==========================================
// Cloud & Local Sync Logic
// ==========================================
let cloudSubscription = null;

async function loadDataFromCloud() {
    isAppLoading = true;
    try {
        let state = null;
        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('board_state').select('data').eq('id', 1).single();
            if (data && data.data) state = data.data;
        }
        
        if (!state) {
            const localStr = await idbGet('mindLinksData');
            if (localStr) state = JSON.parse(localStr);
        }

        if (!state) throw new Error('No data found');
        
        panX = state.panX || 0;
        panY = state.panY || 0;
        zoom = state.zoom || 1;
        updateWorkspace();
        
        nodesLayer.innerHTML = '';
        nodes = [];
        if (state.nodes && state.nodes.length > 0) {
            state.nodes.forEach(n => createNode(n.x, n.y, n.data, false));
        } else {
            createDefaultNode();
        }

        // Setup Realtime Subscription
        if (supabaseClient && !cloudSubscription) {
            cloudSubscription = supabaseClient.channel('public:board_state')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_state' }, payload => {
                    const newState = payload.new.data;
                    if (newState) {
                        isAppLoading = true;
                        nodesLayer.innerHTML = '';
                        nodes = [];
                        if (newState.nodes) newState.nodes.forEach(n => createNode(n.x, n.y, n.data, false));
                        isAppLoading = false;
                        idbSet('mindLinksData', JSON.stringify(newState)); // backup locally
                    }
                })
                .subscribe();
        }
    } catch (err) {
        console.warn('Failed to load data, creating default node', err);
        createDefaultNode();
    }
    
    isAppLoading = false;
}

function triggerSave() {
    if (isAppLoading) return;
    
    // Clear any pending save
    if (saveTimeout) clearTimeout(saveTimeout);
    
    // Debounce save for 1.5 seconds to prevent rate limits
    saveTimeout = setTimeout(saveDataToCloud, 1500);
}

async function saveDataToCloud() {
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
        await idbSet('mindLinksData', JSON.stringify(state));
        if (supabaseClient) {
            await supabaseClient.from('board_state').upsert({ id: 1, data: state });
        }
    } catch (e) {
        console.warn('Failed to save data', e);
    }
}

// ==========================================
// Workspace Logic
// ==========================================
function updateWorkspace() {
    workspace.style.transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`;
}

workspaceContainer.addEventListener('mousedown', (e) => {
    if (e.target !== workspaceContainer && e.target !== workspace && e.target.id !== 'space-canvas') return;
    if (e.button !== 0 && e.button !== 1) return;
    
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
        triggerSave();
    }
});

workspaceContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    
    const rect = workspaceContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width/2;
    const mouseY = e.clientY - rect.top - rect.height/2;

    const oldZoom = zoom;
    zoom = Math.max(0.1, Math.min(5, zoom * Math.exp(delta)));

    panX += mouseX / zoom - mouseX / oldZoom;
    panY += mouseY / zoom - mouseY / oldZoom;
    
    updateWorkspace();
    triggerSave();
}, { passive: false });

// ==========================================
// Node Management
// ==========================================
function createNode(x, y, data = {}, triggerCloudSave = true) {
    nodeCounter++;
    const id = 'node-' + nodeCounter;
    
    const el = document.createElement('div');
    el.className = 'node';
    el.id = id;
    el.style.margin = '0';
    
    x = x || 0;
    y = y || 0;

    const hasLink = data.link && data.link.trim() !== '';
    const dateType = data.date ? 'date' : 'text';
    const timeType = data.time ? 'time' : 'text';

    el.innerHTML = `
        <div class="node-header">
            <div class="drag-handle" title="اسحب من هنا"><i class="fas fa-grip-vertical"></i></div>
            <input type="text" class="node-title" placeholder="عنوان الفكرة..." value="${data.title || ''}">
            <div class="node-actions">
                <button class="delete-btn"><i class="fas fa-times"></i></button>
            </div>
        </div>
        <div class="node-content">
            <div class="node-image-container">
                <div class="upload-placeholder" style="${data.imageSrc ? 'display:none;' : ''}">
                    <i class="fas fa-image"></i>
                    <span>لصق أو رفع صورة</span>
                </div>
                <img src="${data.imageSrc || ''}" style="${data.imageSrc ? 'display:block;' : ''}">
                <input type="file" style="display:none;" accept="image/*">
            </div>
            <textarea class="node-notes" placeholder="اكتب الوصف والملاحظات هنا...">${data.notes || ''}</textarea>
            <div class="link-wrapper">
                <div class="link-display" style="${hasLink ? '' : 'display:none;'}">
                    <a href="${hasLink ? data.link : '#'}" target="_blank">
                        <i class="fas fa-rocket"></i> <span class="link-text">فتح الرابط</span>
                    </a>
                    <button class="edit-link-btn" title="تعديل الرابط"><i class="fas fa-pen"></i></button>
                </div>
                <div class="link-edit" style="${hasLink ? 'display:none;' : ''}">
                    <input type="url" class="node-link-input" placeholder="ألصق الرابط هنا..." value="${data.link || ''}">
                    <button class="save-link-btn"><i class="fas fa-check"></i></button>
                </div>
            </div>
            <div class="node-date-wrapper">
                <div class="date-icon"><i class="fas fa-calendar-alt"></i></div>
                <input type="${dateType}" class="node-date" value="${data.date || ''}" onfocus="(this.type='date')" onblur="if(!this.value)this.type='text'">
                <input type="${timeType}" class="node-time" value="${data.time || ''}" onfocus="(this.type='time')" onblur="if(!this.value)this.type='text'">
            </div>
        </div>
    `;
    
    nodesLayer.appendChild(el);

    const nodeObj = { id, el, x, y, data };
    nodes.push(nodeObj);
    
    updateNodePosition(nodeObj);
    setupNodeInteractions(nodeObj);
    
    if (triggerCloudSave) triggerSave();
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
            triggerSave();
        }
    });

    // Delete
    el.querySelector('.delete-btn').addEventListener('click', () => {
        nodes = nodes.filter(n => n !== nodeObj);
        el.remove();
        triggerSave();
    });

    // Inputs
    const titleInput = el.querySelector('.node-title');
    titleInput.addEventListener('input', () => { nodeObj.data.title = titleInput.value; triggerSave(); });
    
    const notesInput = el.querySelector('.node-notes');
    notesInput.addEventListener('input', () => { nodeObj.data.notes = notesInput.value; triggerSave(); });
    
    const dateInput = el.querySelector('.node-date');
    dateInput.addEventListener('input', () => { nodeObj.data.date = dateInput.value; triggerSave(); });
    
    const timeInput = el.querySelector('.node-time');
    timeInput.addEventListener('input', () => { nodeObj.data.time = timeInput.value; triggerSave(); });

    // Link UI
    const linkDisplay = el.querySelector('.link-display');
    const linkEdit = el.querySelector('.link-edit');
    const linkInput = el.querySelector('.node-link-input');
    const saveLinkBtn = el.querySelector('.save-link-btn');
    const editLinkBtn = el.querySelector('.edit-link-btn');
    const linkAnchor = el.querySelector('.link-display a');

    function saveLink() {
        const url = linkInput.value.trim();
        nodeObj.data.link = url;
        triggerSave();
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
    if (!linkInput.value) {
        linkDisplay.style.display = 'none';
        linkEdit.style.display = 'flex';
    }

    // Image Upload
    const fileInput = el.querySelector('input[type="file"]');
    const img = el.querySelector('img');
    const placeholder = el.querySelector('.upload-placeholder');

    placeholder.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
            const compressedBase64 = await compressImage(e.target.files[0]);
            img.src = compressedBase64;
            img.style.display = 'block';
            placeholder.style.display = 'none';
            nodeObj.data.imageSrc = compressedBase64;
            triggerSave();
        }
    });
}

function createDefaultNode() {
    createNode(-150, -100, {
        title: 'مرحباً بك 🚀',
        notes: 'هذه المساحة الآن سحابية! أي تغيير يتم حفظه للجميع.',
        link: 'https://google.com',
        visibility: 'public'
    }, true);
}

// ==========================================
// Right Click Workspace -> Add Node
// ==========================================
window.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.node') || e.target.closest('#login-overlay')) return;
    e.preventDefault();
    const rect = workspace.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - 150;
    const y = (e.clientY - rect.top) / zoom - 50;
    createNode(x, y);
});

// ==========================================
// Paste & Drop
// ==========================================
window.addEventListener('paste', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let pastedText = e.clipboardData.getData('text');
    const rect = workspace.getBoundingClientRect();
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

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.target.closest('input[type="file"]') || e.target.closest('#login-overlay')) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const rect = workspace.getBoundingClientRect();
        const dropX = (e.clientX - rect.left) / zoom - 150;
        const dropY = (e.clientY - rect.top) / zoom - 100;
        
        Array.from(e.dataTransfer.files).forEach((file, index) => {
            if (file.type.startsWith('image/')) {
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

// ==========================================
// Background Canvas
// ==========================================
const canvas = document.getElementById('space-canvas');
const ctx = canvas.getContext('2d');
let cw, ch;
const stars = [];
for(let i=0; i<800; i++) {
    stars.push({
        x: (Math.random() - 0.5) * 4000,
        y: (Math.random() - 0.5) * 4000,
        z: Math.random() * 2 + 0.2,
        radius: Math.random() * 1.5,
        alpha: Math.random(),
        color: Math.random() > 0.8 ? '#a855f7' : (Math.random() > 0.5 ? '#3b82f6' : '#ffffff')
    });
}
function resizeCanvas() {
    cw = canvas.width = window.innerWidth;
    ch = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const mouseParticles = [];
let lastMouseX = 0, lastMouseY = 0;
class MouseParticle {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.size = Math.random() * 2 + 1;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = Math.random() * 2 - 1;
        this.life = 1.0;
        this.decay = Math.random() * 0.03 + 0.01;
        const colors = ['#00d2ff', '#a855f7', '#ec4899', '#ffffff'];
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }
    update() { this.x += this.speedX; this.y += this.speedY; this.life -= this.decay; }
    draw(ctx) {
        ctx.globalAlpha = this.life; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
    }
}
window.addEventListener('mousemove', (e) => {
    const dist = Math.hypot(e.clientX - lastMouseX, e.clientY - lastMouseY);
    if (dist > 5) {
        mouseParticles.push(new MouseParticle(e.clientX, e.clientY));
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
    if (mouseParticles.length > 40) {
        mouseParticles.shift();
    }
});
function drawSpace() {
    ctx.clearRect(0, 0, cw, ch);
    stars.forEach(s => {
        let sx = (s.x + panX * s.z * 0.5) % 4000;
        let sy = (s.y + panY * s.z * 0.5) % 4000;
        if (sx > 2000) sx -= 4000; if (sx < -2000) sx += 4000;
        if (sy > 2000) sy -= 4000; if (sy < -2000) sy += 4000;
        const screenX = sx * Math.sqrt(zoom) + cw/2;
        const screenY = sy * Math.sqrt(zoom) + ch/2;
        if (screenX > 0 && screenX < cw && screenY > 0 && screenY < ch) {
            ctx.globalAlpha = s.alpha; ctx.fillStyle = s.color;
            const size = s.radius * Math.sqrt(zoom) * 2;
            ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
        }
        s.alpha += (Math.random() - 0.5) * 0.1;
        if (s.alpha > 1) s.alpha = 1; if (s.alpha < 0.2) s.alpha = 0.2;
    });
    for (let i = 0; i < mouseParticles.length; i++) {
        mouseParticles[i].update(); mouseParticles[i].draw(ctx);
        if (mouseParticles[i].life <= 0) { mouseParticles.splice(i, 1); i--; }
    }
    requestAnimationFrame(drawSpace);
}
drawSpace();

// ==========================================
// Backup Export/Import (Optional)
// ==========================================
document.getElementById('export-btn').addEventListener('click', () => {
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
    const dataStr = JSON.stringify(state);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mind-links-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
});
document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = event.target.result;
            const parsed = JSON.parse(data);
            await idbSet('mindLinksData', JSON.stringify(parsed));
            alert('تم استيراد البيانات بنجاح!');
            location.reload();
        } catch (err) { alert('حدث خطأ أثناء الاستيراد!'); console.error(err); }
        e.target.value = '';
    };
    reader.readAsText(file);
});

// Load data immediately on start
loadDataFromCloud();
