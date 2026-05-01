/* Main JavaScript */

document.addEventListener('DOMContentLoaded', () => {
    const disableZoomGestures = () => {
        const isTouch =
            'ontouchstart' in window ||
            navigator.maxTouchPoints > 0 ||
            navigator.msMaxTouchPoints > 0
        if (!isTouch) return

        const isEditable = (el) => {
            if (!el) return false
            const tag = el.tagName ? el.tagName.toLowerCase() : ''
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
            return el.isContentEditable === true
        }

        const preventGesture = (event) => {
            event.preventDefault()
        }

        ;['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
            document.addEventListener(type, preventGesture, { passive: false })
        })

        document.addEventListener(
            'touchmove',
            (event) => {
                if (event.touches && event.touches.length > 1) {
                    event.preventDefault()
                }
            },
            { passive: false }
        )

        let lastTouchEnd = 0
        document.addEventListener(
            'touchend',
            (event) => {
                if (isEditable(event.target)) return
                const now = Date.now()
                if (now - lastTouchEnd <= 300) {
                    event.preventDefault()
                }
                lastTouchEnd = now
            },
            { passive: false }
        )

        document.addEventListener(
            'dblclick',
            (event) => {
                if (isEditable(event.target)) return
                event.preventDefault()
            },
            { passive: false }
        )
    }

    disableZoomGestures()

    /*==================== SHOW MENU ====================*/
    const navMenu = document.getElementById('nav-menu'),
        navToggle = document.getElementById('nav-toggle'),
        navClose = document.getElementById('nav-close')
    navMenu?.classList.remove('show-menu')

    /* Validate if constant exists */
    if (navToggle) {
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('show-menu')
        })
    }

    /* Validate if constant exists */
    if (navClose) {
        navClose.addEventListener('click', () => {
            navMenu.classList.remove('show-menu')
        })
    }

    /*==================== REMOVE MENU MOBILE ====================*/
    const navLink = document.querySelectorAll('.nav__link')

    function linkAction() {
        const navMenu = document.getElementById('nav-menu')
        // When we click on each nav__link, we remove the show-menu class
        navMenu.classList.remove('show-menu')
    }
    navLink.forEach(n => n.addEventListener('click', linkAction))

    /*==================== MOBILE APP SHELL VIEWS ====================*/
    const bottomNav = document.querySelector('.dm-bottom-nav')
    const bottomNavLinks = bottomNav ? bottomNav.querySelectorAll('[data-route]') : []
    const appShellQuery = window.matchMedia('(max-width: 768px)')
    const displayModeQuery = window.matchMedia('(display-mode: standalone)')
    const viewAlias = {
        carrete: 'carrete',
        muro: 'carrete',
        estructura: 'estructura',
        comites: 'comites',
        foro: 'foro',
        'estructura-funcional': 'estructura',
        'galeria-operativa': 'carrete'
    }

    const isAppShell = () => appShellQuery.matches || displayModeQuery.matches

    const unlockScrollIfSafe = () => {
        const html = document.documentElement
        const body = document.body
        if (!html || !body) return

        const aiOpen =
            html.classList.contains('dm-ai-open') || body.classList.contains('dm-ai-open')
        const modalOpen = body.classList.contains('dm-modal-open')
        if (aiOpen || modalOpen) return

        html.classList.remove('dm-scroll-locked')
        body.classList.remove('dm-scroll-locked')
        body.style.position = ''
        body.style.top = ''
        body.style.left = ''
        body.style.right = ''
        body.style.width = ''
    }

    const updateNavState = (route) => {
        if (!bottomNavLinks.length) return
        bottomNavLinks.forEach((link) => {
            const isActive = link.dataset.route === route
            link.classList.toggle('is-active', isActive)
            if (isActive) {
                link.setAttribute('aria-current', 'page')
            } else {
                link.removeAttribute('aria-current')
            }
        })
    }

    const setViewFromHash = () => {
        if (!isAppShell()) {
            document.body.removeAttribute('data-view')
            return
        }
        const raw = (window.location.hash || '').replace('#', '').trim().toLowerCase()
        const route = viewAlias[raw] || 'carrete'
        if (!raw || raw !== route) {
            history.replaceState(null, '', `#${route}`)
        }
        document.body.dataset.view = route
        updateNavState(route)
        unlockScrollIfSafe()
    }

    const handleShellChange = () => setViewFromHash()

    if (appShellQuery.addEventListener) {
        appShellQuery.addEventListener('change', handleShellChange)
    } else {
        appShellQuery.addListener(handleShellChange)
    }
    if (displayModeQuery.addEventListener) {
        displayModeQuery.addEventListener('change', handleShellChange)
    } else {
        displayModeQuery.addListener(handleShellChange)
    }
    window.addEventListener('hashchange', setViewFromHash)
    setViewFromHash()

    /*==================== REFERENTES: DESKTOP OPEN ====================*/
    const referentesQuery = window.matchMedia('(min-width: 1024px)')
    const referentesContainer = document.querySelector('.dm-accordion')
    const syncReferentesAccordion = () => {
        const items = document.querySelectorAll('.dm-accordion__item')
        const summaries = document.querySelectorAll('.dm-accordion__summary')
        if (!items.length) return
        if (referentesQuery.matches) {
            items.forEach((item) => item.setAttribute('open', ''))
            summaries.forEach((summary) => {
                summary.setAttribute('aria-disabled', 'true')
                summary.setAttribute('tabindex', '-1')
            })
        } else {
            items.forEach((item) => item.removeAttribute('open'))
            summaries.forEach((summary) => {
                summary.removeAttribute('aria-disabled')
                summary.removeAttribute('tabindex')
            })
        }
    }
    if (referentesContainer) {
        referentesContainer.addEventListener('click', (event) => {
            if (!referentesQuery.matches) return
            const summary = event.target.closest('.dm-accordion__summary')
            if (!summary) return
            event.preventDefault()
        })
        referentesContainer.addEventListener('keydown', (event) => {
            if (!referentesQuery.matches) return
            if (event.key !== 'Enter' && event.key !== ' ') return
            const summary = event.target.closest('.dm-accordion__summary')
            if (!summary) return
            event.preventDefault()
        })
    }
    if (referentesQuery.addEventListener) {
        referentesQuery.addEventListener('change', syncReferentesAccordion)
    } else {
        referentesQuery.addListener(syncReferentesAccordion)
    }
    syncReferentesAccordion()

    const closeReferentes = (except) => {
        if (!referentesContainer) return
        referentesContainer.querySelectorAll('.dm-accordion__item[open]').forEach((item) => {
            if (item !== except) item.removeAttribute('open')
        })
    }

    if (referentesContainer) {
        referentesContainer.querySelectorAll('.dm-accordion__item').forEach((item) => {
            item.addEventListener('toggle', () => {
                if (referentesQuery.matches) return
                if (item.open) closeReferentes(item)
            })
        })

        document.addEventListener('click', (event) => {
            if (referentesQuery.matches) return
            if (referentesContainer.contains(event.target)) return
            closeReferentes()
        })
    }

    /*==================== SHOW SCROLL UP ====================*/
    function scrollUp() {
        const scrollUp = document.getElementById('scroll-up');
        // When the scroll is higher than 200 viewport height, add the show-scroll class to the a tag with the scroll-top class
        if (this.scrollY >= 200) scrollUp.classList.add('show-scroll'); else scrollUp.classList.remove('show-scroll')
    }
    /*==================== CHANGE BACKGROUND HEADER ====================*/
    function scrollHeader() {
        const nav = document.getElementById('header')
        // When the scroll is greater than 80 viewport height, add the scroll-header class
        if (this.scrollY >= 80) nav.classList.add('scroll-header'); else nav.classList.remove('scroll-header')
    }
    window.addEventListener('scroll', scrollHeader)
    window.addEventListener('scroll', scrollUp)
    const scrollUpBtn = document.getElementById('scroll-up')
    if (scrollUpBtn) {
        scrollUpBtn.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            window.scrollTo({ top: 0, behavior: 'smooth' })
        })
    }

    /*==================== DASHBOARD LOGIC ====================*/
    // State
    const PHASES = [
        {
            id: 'F1',
            name: 'Planificación',
            colorClass: 'bg-f1',
            darkBorderClass: 'ring-f1',
            textClass: 'text-f1',
            borderClass: 'border-f1',
            bgClass: 'bg-light-f1',
            textPhaseClass: 'text-phase-f1'
        },
        {
            id: 'F2',
            name: 'Programación',
            colorClass: 'bg-f2',
            darkBorderClass: 'ring-f2',
            textClass: 'text-f2',
            borderClass: 'border-f2',
            bgClass: 'bg-light-f2',
            textPhaseClass: 'text-phase-f2'
        },
        {
            id: 'F3',
            name: 'Desarrollo',
            colorClass: 'bg-f3',
            darkBorderClass: 'ring-f3',
            textClass: 'text-f3',
            borderClass: 'border-f3',
            bgClass: 'bg-light-f3',
            textPhaseClass: 'text-phase-f3'
        },
        {
            id: 'F4',
            name: 'Ejecución',
            colorClass: 'bg-f4',
            darkBorderClass: 'ring-f4',
            textClass: 'text-f4',
            borderClass: 'border-f4',
            bgClass: 'bg-light-f4',
            textPhaseClass: 'text-phase-f4'
        }
    ];

    // Load data from localStorage or use default
    const STORAGE_KEY = 'dashboard_data_v1';

    const defaultTasks = [
        // FASE 1
        { id: 1, text: 'Definición de estatutos y marcos legales', phase: 'F1', completed: true },
        { id: 2, text: 'Validación de factibilidad y alcance', phase: 'F1', completed: false },
        { id: 3, text: 'Diseño de la estructura funcional', phase: 'F1', completed: false },
        // FASE 2
        { id: 4, text: 'Selección de referentes de comités', phase: 'F2', completed: false },
        { id: 5, text: 'Establecer cronogramas', phase: 'F2', completed: false },
        { id: 6, text: 'Gestión de recursos y alianzas clave', phase: 'F2', completed: false },
        // FASE 3
        { id: 7, text: 'Distribución del personal en comités', phase: 'F3', completed: false },
        { id: 8, text: 'Habilitación de sistemas para uso del personal', phase: 'F3', completed: false },
        { id: 9, text: 'Desarrollo de proyectos', phase: 'F3', completed: false },
        // FASE 4
        { id: 10, text: 'Activación operativa y gestión de turnos', phase: 'F4', completed: false },
        { id: 11, text: 'Monitorización de KPIs y auditorías', phase: 'F4', completed: false },
        { id: 12, text: 'Implementación de mejoras continuas', phase: 'F4', completed: false },
    ];

    // Initialize state
    let storedData = JSON.parse(localStorage.getItem(STORAGE_KEY));

    // Handle migration or first load
    let tasks = [];
    let lastUpdated = Date.now();

    if (storedData && storedData.tasks) {
        tasks = storedData.tasks;
        lastUpdated = storedData.lastUpdated || Date.now();
    } else if (Array.isArray(storedData)) {
        // Fallback for previous simple array storage
        tasks = storedData;
    } else {
        tasks = defaultTasks;
    }

    let isOpen = false;
    let newTaskText = '';
    let selectedPhase = 'F1';

    // Icons (SVGs)
    const Icons = {
        LayoutDashboard: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
        ChevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
        Check: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
        Trash2: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
        Info: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
        Plus: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`
    };

    function saveTasks() {
        lastUpdated = Date.now();
        const data = {
            tasks: tasks,
            lastUpdated: lastUpdated
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('LocalStorage not available:', e);
        }
    }

    function formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    function initDashboard() {
        renderDashboard();
    }

    function getSortedTasks() {
        return [...tasks].sort((a, b) => {
            const phaseIndexA = PHASES.findIndex(p => p.id === a.phase);
            const phaseIndexB = PHASES.findIndex(p => p.id === b.phase);

            if (phaseIndexA !== phaseIndexB) {
                return phaseIndexA - phaseIndexB;
            }
            return a.id - b.id;
        });
    }

    function getProgressData() {
        return PHASES.map(phase => {
            const phaseTasks = tasks.filter(t => t.phase === phase.id);
            const completedTasks = phaseTasks.filter(t => t.completed);
            const total = phaseTasks.length;
            const percentage = total === 0 ? 0 : Math.round((completedTasks.length / total) * 100);
            return { ...phase, percentage };
        });
    }

    function renderDashboard() {
        const root = document.getElementById('custom-dashboard-root');
        if (!root) return;

        // Ocultar el dashboard de "Evolución del Desarrollo"
        root.innerHTML = '';
        root.style.display = 'none';
        return;

        const progressData = getProgressData();
        const sortedTasks = getSortedTasks();
        const formattedDate = formatDate(lastUpdated);

        // Generate HTML
        const html = `
        <div class="dashboard-container ${isOpen ? 'is-open' : ''}">
            
            <!-- Header -->
            <button id="dashboard-toggle-btn" class="dashboard-header">
                <div class="dashboard-header-left">
                    <div class="dashboard-icon-box">
                        ${Icons.LayoutDashboard}
                    </div>
                    <div>
                        <h2 class="dashboard-eyebrow">Progreso Operativo</h2>
                        <h1 class="dashboard-title">Evolución del Desarrollo</h1>
                    </div>
                </div>
                <div class="dashboard-header-right">
                    <div class="header-info-wrapper" onclick="event.stopPropagation()">
                        <div class="header-info-icon">
                            ${Icons.Info}
                        </div>
                        <div class="header-tooltip-content">
                            <div class="tooltip-arrow"></div>
                            <p>Haz click en la flecha para expandir o contraer el menú del dashboard de progreso.</p>
                        </div>
                    </div>
                    <div class="dashboard-chevron">
                        ${Icons.ChevronDown}
                    </div>
                </div>
            </button>

            <!-- Content -->
            <div class="dashboard-content">
                <div class="dashboard-layout">
                    
                    <!-- Chart Column -->
                    <div class="chart-column">
                        
                        <!-- Live Badge -->
                        <div class="live-badge">
                            <div class="live-dot-container">
                                <span class="live-dot-ping"></span>
                                <span class="live-dot"></span>
                            </div>
                            <span class="live-text">En vivo</span>
                        </div>

                        <!-- Chart -->
                        <div class="chart-container">
                            <div class="bars-area">
                                <!-- Grid Lines -->
                                <div class="grid-lines">
                                    ${[100, 75, 50, 25, 0].map(() => `<div class="grid-line"></div>`).join('')}
                                </div>

                                <!-- Bars -->
                                <div class="bars-wrapper">
                                    ${progressData.map(phase => `
                                        <div class="bar-group">
                                            <div class="bar-percentage ${phase.percentage > 0 ? phase.textPhaseClass : 'text-gray-400'}">
                                                ${phase.percentage}%
                                            </div>
                                            <div class="bar-track">
                                                <div class="bar-fill ${phase.colorClass} ${phase.darkBorderClass}" style="height: ${phase.percentage}%">
                                                    <div class="bar-shine"></div>
                                                </div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>

                            <!-- Labels -->
                            <div class="labels-area">
                                ${progressData.map(phase => `
                                    <div class="label-wrapper">
                                        <span class="phase-tag">
                                            ${phase.id.replace('F', 'Fase ')}
                                        </span>
                                        <span class="phase-name">
                                            ${phase.name}
                                        </span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>

                    <!-- List Column -->
                    <div class="list-column">
                        
                        <!-- List Header -->
                        <div class="list-header">
                            <span class="list-title-text">Lista de Tareas</span>
                            <div class="phase-dots">
                                ${PHASES.map(p => `<div class="phase-dot ${p.colorClass}" title="${p.name}"></div>`).join('')}
                            </div>
                        </div>

                        <!-- Scrollable List -->
                        <div class="list-scroll-area custom-scrollbar">
                            ${sortedTasks.map(task => {
            const phaseInfo = PHASES.find(p => p.id === task.phase);
            return `
                                    <div class="task-item ${task.completed ? 'completed' : ''}">
                                        <button class="task-checkbox-btn ${task.completed ? 'checked' : ''}" onclick="window.toggleTask(${task.id})">
                                            <div class="task-check-icon">${Icons.Check}</div>
                                        </button>

                                        <div class="task-text-content">
                                            <p class="task-text">${task.text}</p>
                                        </div>

                                        <span class="task-phase-badge ${phaseInfo.textClass} ${phaseInfo.bgClass} ${phaseInfo.borderClass}">
                                            ${task.phase}
                                        </span>
                                        
                                        <button class="task-delete-btn" onclick="window.deleteTask(${task.id})">
                                            ${Icons.Trash2}
                                        </button>
                                    </div>
                                `;
        }).join('')}
                        </div>

                        <!-- Footer Input -->
                        <div class="list-footer">
                            <form id="add-task-form" class="input-form">
                                
                                <!-- Info Tooltip -->
                                <div class="info-tooltip-container">
                                    <div class="info-icon">${Icons.Info}</div>
                                    <div class="tooltip-content">
                                        <div class="tooltip-arrow"></div>
                                        <p style="margin-bottom: 0.5rem;">
                                            <span style="color: #4CAF50; font-weight: bold;">*</span> 
                                            Para agregar nueva tarea escribir el nombre, asignar fase (F) y click en (+).
                                        </p>
                                        <p>
                                            <span style="color: #ef4444; font-weight: bold;">*</span> 
                                            Para borrar una tarea: click en el tachito de basura a la derecha.
                                        </p>
                                    </div>
                                </div>

                                <div class="task-input-wrapper">
                                    <input
                                        type="text"
                                        id="new-task-input"
                                        placeholder="Nueva tarea..."
                                        class="task-input"
                                        value="${newTaskText}"
                                        autocomplete="off"
                                    />
                                </div>
                                <select id="phase-select" class="phase-select">
                                    ${PHASES.map(p => `<option value="${p.id}" ${selectedPhase === p.id ? 'selected' : ''}>${p.id}: ${p.name}</option>`).join('')}
                                </select>
                                <button type="submit" class="add-btn" ${!newTaskText.trim() ? 'disabled' : ''}>
                                    ${Icons.Plus}
                                </button>
                            </form>
                            <div class="dashboard-last-updated">
                                Fecha de última actualización ${formattedDate}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
        `;

        root.innerHTML = html;

        // Re-attach event listeners
        document.getElementById('dashboard-toggle-btn').addEventListener('click', () => {
            isOpen = !isOpen;
            renderDashboard();
        });

        const form = document.getElementById('add-task-form');
        const input = document.getElementById('new-task-input');
        const select = document.getElementById('phase-select');

        // Input binding
        input.addEventListener('input', (e) => {
            newTaskText = e.target.value;
            // Re-render only button state if needed, but simple re-render is fine for now
            const btn = form.querySelector('button[type="submit"]');
            if (newTaskText.trim()) {
                btn.removeAttribute('disabled');
            } else {
                btn.setAttribute('disabled', 'true');
            }
        });

        select.addEventListener('change', (e) => {
            selectedPhase = e.target.value;
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!newTaskText.trim()) return;

            const newTask = {
                id: Date.now(),
                text: newTaskText,
                phase: selectedPhase,
                completed: false
            };
            tasks = [...tasks, newTask];
            saveTasks(); // Save to storage
            newTaskText = '';
            renderDashboard();

            // Focus back on input
            setTimeout(() => {
                const newInput = document.getElementById('new-task-input');
                if (newInput) newInput.focus();
            }, 0);
        });
    }

    // Global handlers for inline onclicks
    window.toggleTask = (id) => {
        tasks = tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
        saveTasks(); // Save to storage
        renderDashboard();
    };

    window.deleteTask = (id) => {
        tasks = tasks.filter(t => t.id !== id);
        saveTasks(); // Save to storage
        renderDashboard();
    };

    // Init
    initDashboard();
});


/* LOGIN MODAL LOGIC */
document.addEventListener('DOMContentLoaded', () => {
    // checkLoginStatus(); // Disabled temporarily
});

function checkLoginStatus() {
    let isLoggedIn = 'false';
    try {
        isLoggedIn = sessionStorage.getItem('isLoggedIn');
    } catch (e) {
        console.warn('SessionStorage not available:', e);
    }

    const loginModal = document.getElementById('login-modal');

    if (isLoggedIn === 'true') {
        // User is logged in, hide modal immediately
        if (loginModal) {
            loginModal.style.display = 'none';
        }
    } else {
        // User is not logged in, show modal
        if (loginModal) {
            loginModal.style.display = 'flex';
        }
    }
}

window.handleLogin = function (e) {
    e.preventDefault();

    const passwordInput = document.getElementById('password');

    const configuredPassword = String(window.__LOGIN_PASSWORD__ || '').trim();
    const configuredAlt = String(window.__LOGIN_PASSWORD_ALT__ || '').trim();

    if (!configuredPassword) {
        console.warn('Login modal bypassed: no password configured. Set window.__LOGIN_PASSWORD__ to enable.');
        try {
            sessionStorage.setItem('isLoggedIn', 'true');
        } catch (e) {
            console.warn('SessionStorage not available:', e);
        }
        const loginModal = document.getElementById('login-modal');
        if (loginModal) {
            loginModal.style.display = 'none';
        }
        return;
    }

    const password = passwordInput.value;

    if (!password) {
        showToast('warning', 'Ingresa la contraseña para continuar.');
        passwordInput.focus();
        return;
    }

    if (password === configuredPassword || (configuredAlt && password === configuredAlt)) {
        // Success
        try {
            sessionStorage.setItem('isLoggedIn', 'true');
        } catch (e) {
            console.warn('SessionStorage not available:', e);
        }

        const loginModal = document.getElementById('login-modal');

        // Animate out
        if (loginModal) {
            loginModal.style.opacity = '0';
            loginModal.style.transition = 'opacity 0.5s ease';
            setTimeout(() => {
                loginModal.style.display = 'none';
            }, 500);
        }

        Swal.fire({
            title: 'Acceso Correcto',
            text: 'Bienvenido al sistema BRISA',
            icon: 'success',
            iconColor: '#2E6B46',
            confirmButtonColor: '#2E6B46',
            confirmButtonText: 'Continuar'
        }).then(() => {
            passwordInput.value = '';
        });

    } else {
        // Error
        Swal.fire({
            title: 'Error de Acceso',
            text: 'La contraseña ingresada no es válida.',
            icon: 'error',
            confirmButtonColor: '#d33',
            confirmButtonText: 'Reintentar'
        });

        // Shake animation
        passwordInput.classList.add('shake');
        setTimeout(() => {
            passwordInput.classList.remove('shake');
            passwordInput.focus();
        }, 500);
    }
}

window.handleForgotPassword = function (e) {
    e.preventDefault();

    Swal.fire({
        html: `
            <div style="text-align: left; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <h3 style="font-size: 1.1rem; font-weight: 600; color: #111827; margin-bottom: 0.5rem;">Recuperar Acceso</h3>
                <p style="font-size: 0.9rem; color: #6b7280; margin-bottom: 1.5rem;">Contacta al administrador para restablecer tu contraseña.</p>
                
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <!-- WhatsApp -->
                    <a href="https://wa.me/5491124542499" target="_blank" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-radius: 0.5rem; background-color: #f3f4f6; text-decoration: none; color: inherit; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">
                        <i class="fa-brands fa-whatsapp" style="color: #4b5563; font-size: 1.25rem; width: 1.5rem; text-align: center;"></i>
                        <span style="font-size: 0.95rem; font-weight: 500; color: #374151;">11 2454-2499</span>
                    </a>

                    <!-- Mail -->
                    <a href="mailto:HRodriguez@pan-energy.com" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-radius: 0.5rem; background-color: #f3f4f6; text-decoration: none; color: inherit; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">
                        <i class="fa-solid fa-envelope" style="color: #4b5563; font-size: 1.1rem; width: 1.5rem; text-align: center;"></i>
                        <span style="font-size: 0.95rem; font-weight: 500; color: #374151;">HRodriguez@pan-energy.com</span>
                    </a>
                </div>
            </div>
        `,
        width: '380px',
        showConfirmButton: false,
        showCloseButton: true,
        padding: '1.5rem',
        background: '#ffffff',
        customClass: {
            popup: 'rounded-xl shadow-2xl', // More rounded, softer shadow
            closeButton: 'focus:outline-none'
        }
    });
}

function showToast(icon, title) {
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer)
            toast.addEventListener('mouseleave', Swal.resumeTimer)
        }
    })
    Toast.fire({ icon: icon, title: title })
}

window.togglePasswordVisibility = function () {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.getElementById('toggleIcon');

    // Toggle the masking class
    if (passwordInput.classList.contains('password-masked')) {
        // Show password
        passwordInput.classList.remove('password-masked');
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash');
    } else {
        // Hide password
        passwordInput.classList.add('password-masked');
        toggleIcon.classList.remove('fa-eye-slash');
        toggleIcon.classList.add('fa-eye');
    }

    passwordInput.focus();
}

/* =========================================
   ESTRUCTURA FUNCIONAL LOGIC
   ========================================= */

// --- ICONS (SVG Strings) ---
const StructureIcons = {
    Pumpjack: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 501.352 501.352" fill="currentColor" xmlSpace="preserve"><path d="M490.676,474.686H448.01V185.619c10.88-11.2,13.76-27.84,7.147-42.027L401.503,27.326 c-8.747-18.987-31.147-27.2-50.133-18.56c-1.067,0.533-2.133,1.067-3.093,1.6l-20.053,11.627 c-18.133,10.453-24.213,33.707-13.76,51.733c0.533,0.96,1.173,1.92,1.813,2.773l17.067,24.32L88.436,242.046 c-13.12,7.573-17.707,24.32-10.133,37.547v0.107c1.813,2.987,4.16,5.547,6.933,7.68v155.307H64.009 c-5.867,0-10.667,4.8-10.667,10.667v21.333H10.996c-5.333,0-10.133,3.84-10.88,9.067c-0.96,6.613,4.16,12.267,10.56,12.267h479.68 c5.333,0,10.133-3.84,10.88-9.067C502.196,480.339,497.076,474.686,490.676,474.686z M96.223,264.232 c0.427-1.6,1.493-2.987,2.88-3.733l246.613-142.08l6.933,9.813L105.396,271.166c-2.987,1.707-6.827,0.747-8.533-2.24 C96.009,267.539,95.796,265.832,96.223,264.232z M186.996,325.352l14.08-84.907l99.84-57.707l23.893,142.613H186.996z M310.196,346.686l-54.187,42.133l-54.293-42.133H310.196z M117.343,474.686H74.676v-10.667h42.667V474.686z M138.676,474.686 v-21.333c0-5.867-4.8-10.667-10.667-10.667h-21.333V292.712c3.307-0.427,6.4-1.493,9.387-3.093l61.12-35.307L140.49,474.686 H138.676z M181.45,357.992l57.067,44.373l-74.133,57.6L181.45,357.992z M180.383,474.686l75.627-58.773l75.627,58.773H180.383z M273.396,402.366l56.853-44.16l16.96,101.547L273.396,402.366z M426.783,474.686h-55.36l-50.667-303.36l44.267-25.6 l25.067,35.627c8.107,11.947,22.507,18.027,36.693,15.573V474.686z M427.85,174.312c-7.253,3.307-15.787,1.067-20.373-5.44 L333.77,64.126c-2.773-3.627-3.733-8.32-2.773-12.907c0.96-4.48,3.84-8.427,7.893-10.773l20.053-11.627 c2.453-1.493,5.333-2.24,8.213-2.24c1.707,0,3.413,0.213,5.013,0.747c4.48,1.387,8.107,4.587,10.027,8.853l53.653,116.267 C439.69,160.659,436.063,170.472,427.85,174.312z" /></svg>`,
    Refinery: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 496 496" fill="currentColor" xmlSpace="preserve"><path d="M496,80V64h-16V0H64v64H48v16h16v48H16v64H0v16h16v272H0v16h496v-16h-16V80H496z M320,16h64v16h-64V16z M320,48h64v16h-64V48z M240,16h64v16h-64V16z M240,48h64v16h-64V48z M160,16h64v16h-64V16z M160,48h64v16h-64V48z M80,16h64v16H80V16z M80,48h64v16H80V48z M32,144h48v16H32V144z M32,176h48v16H32V176z M216,288h-16v16h16v80h-16v16h16v80H32v-80h152v-16H32v-80h152v-16H32v-80h184V288z M152,176v16H96v-16H152z M96,160v-16h56v16H96z M216,192h-48v-16h48V192z M216,160h-48v-16h48V160z M368,480H232V333.248l136,71.576V480z M232,315.176v-45.92l32,16.84v45.92L232,315.176z M280,340.432v-45.92l40,21.056v45.92L280,340.432z M368,386.752l-32-16.84v-45.92l32,16.84V386.752z M432,480h-48v-16h48V480z M432,448h-48v-16h48V448z M432,416h-48v-16h48V416z M464,480h-16V336h-16v48h-48v-52.832l-152-80V208h16v-16h-16v-64H80V80h384V480z M464,64h-64V48h64V64z M464,32h-64V16h64V32z"/><rect x="432" y="96" width="16" height="16"/><rect x="400" y="96" width="16" height="16"/><rect x="432" y="128" width="16" height="16"/><rect x="184" y="224" width="16" height="16"/><rect x="152" y="224" width="16" height="16"/><rect x="184" y="256" width="16" height="16"/></svg>`,
    OccupationalHealth: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 96 96" fill="none"><path d="M18,2H78V82a4,4,0,0,1-4,4H22a4,4,0,0,1-4-4V2Z" fill="white" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33,2H63V9a4,4,0,0,1-4,4H37a4,4,0,0,1-4-4V2Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14,6V86a8,8,0,0,0,8,8H18" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M82,6V86a8,8,0,0,1-8,8H78" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14,6h4" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M78,6h4" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><polyline points="40 29 30.71 36 27 32.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><line x1="49" x2="69" y1="32" y2="32" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><polyline points="40 48 30.71 55 27 51.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><line x1="49" x2="69" y1="51" y2="51" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><polyline points="40 67 30.71 74 27 70.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><line x1="49" x2="69" y1="70" y2="70" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    Droplet: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.74 5.88a9.81 9.81 0 1 1-11.48 0l5.74-5.88z"/><path d="M12 2.69l5.74 5.88a9.81 9.81 0 1 1-11.48 0l5.74-5.88z"/></svg>`,
    ChevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    ChevronUp: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
    ChevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
    User: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    UserLarge: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    ClipboardCheck: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>`,
    Building2: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
    MapPin: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`
};

const MEDICAL_USER_UIDS = Object.freeze({
    'Dra. Leila Cura': 'LCura',
    'Leila Cura': 'LCura',
    'Gustavo Silva': 'GSilva',
    'Juan Martín Azcárate': 'JAzcarate',
    'Leandro Medina': 'LMedina',
    'Juan Maurino': 'JMaurino',
    'Hernán Rodríguez': 'HRodriguez',
    'Sergio Aciar': 'SAciar',
    'Adriane Dal Mas': 'ADalMas',
    'Arquímedes Pedraz': 'APedraz',
    'Alberto Bartra': 'ABartra',
    'Marcelo Rosales': 'MRosales',
    'Fernando Mazzarelli': 'GMazzarelli',
    'Roque Ricco': 'RRicco',
    'Cristian Ruben': 'CRuben',
    'Juan Gandarillas': 'JGandarillas',
    'Emmanuel Rivas': 'ERivas',
    'Maximiliano Toledo': 'MToledo',
    'Fiorella Cappelli': 'FCappelli',
    'Braian Salas': 'BSalas',
    'Gabriel Medina': 'GMedina',
    'Pablo Mayo': 'PMayo',
    'Marcelo Calvo': 'MCalvo',
    'Verónica Castro': 'VCastro',
    'Santiago González Calcagno': 'SGonzalezCalcagno',
    'Gastón Castellan': 'GCastellan',
    'Paula Fernández': 'PFernandez',
    'Edgar Jerez': 'EJerez',
    'Francisco Bustos': 'FBustos',
    'Roberto Sabha': 'RSabha',
    'Mario Bianchi': 'MBianchi',
    'José Carlini': 'JCarlini',
    'Betina Robledo': 'BRobledo',
    'Willie Billie Mateo': 'MWilleBille'
});

const createMedicalPerson = (name, extra = {}) => ({
    name,
    uid: MEDICAL_USER_UIDS[name] || '',
    ...extra
});

// --- DATA STRUCTURE ---
const medicalStructure = {
    upstream: {
        id: 'upstream',
        title: 'Upstream',
        subtitle: 'Exploración y Producción',
        leader: 'Gustavo Silva',
        leaderUid: MEDICAL_USER_UIDS['Gustavo Silva'],
        leaderLabel: 'Líder Médico PAE',
        leaderManagementUnit: 'Golfo San Jorge, Neuquén y Acambuco',
        icon: StructureIcons.Pumpjack,
        regions: [
            {
                id: 'gsj',
                name: 'Golfo San Jorge',
                sectors: [
                    {
                        name: 'Cerro Dragón',
                        staff: [
                            createMedicalPerson('Hernán Rodríguez', { role: 'Coordinador', isCoordinator: true }),
                            createMedicalPerson('Sergio Aciar', { role: 'Coordinador', isCoordinator: true })
                        ]
                    },
                    { name: 'Resero', staff: [createMedicalPerson('Adriane Dal Mas'), createMedicalPerson('Arquímedes Pedraz')] },
                    { name: 'Valle Hermoso', staff: [createMedicalPerson('Alberto Bartra'), createMedicalPerson('Marcelo Rosales')] },
                    { name: 'Tres Picos', staff: [createMedicalPerson('Fernando Mazzarelli'), createMedicalPerson('Roque Ricco')] },
                    { name: 'Oriental GSJ', staff: [createMedicalPerson('Cristian Ruben'), createMedicalPerson('Juan Gandarillas')] },
                    { name: 'Anticlinal Grande', staff: [createMedicalPerson('Emmanuel Rivas'), createMedicalPerson('Maximiliano Toledo')] },
                    { name: 'Koluel Kaike', staff: [] },
                    { name: 'Democracia', staff: [createMedicalPerson('Fiorella Cappelli')] }
                ]
            },
            {
                id: 'nqn',
                name: 'Neuquén',
                sectors: [
                    {
                        name: 'ECOR I',
                        staff: [
                            createMedicalPerson('Juan Maurino', { role: 'Coordinador', isCoordinator: true })
                        ]
                    },
                    { name: 'Lindero Oriental', staff: [createMedicalPerson('Braian Salas'), createMedicalPerson('Gabriel Medina')] },
                    { name: 'Itinerante NQN', staff: [createMedicalPerson('Pablo Mayo'), createMedicalPerson('Marcelo Calvo')] },
                    { name: 'Bandurria Centro', staff: [createMedicalPerson('Verónica Castro'), createMedicalPerson('Santiago González Calcagno')] },
                    { name: 'Aguada Pichana Oeste', staff: [createMedicalPerson('Gastón Castellan'), createMedicalPerson('Paula Fernández')] },
                    { name: 'Coirón Amargo Sur Este', staff: [createMedicalPerson('Edgar Jerez'), createMedicalPerson('Francisco Bustos')] },
                    { name: 'Aguada Cánepa', staff: [] }
                ]
            },
            {
                id: 'aca',
                name: 'Acambuco',
                sectors: [
                    {
                        name: 'Planta Piquirenda',
                        staff: [
                            createMedicalPerson('Roberto Sabha', { role: 'Coordinador', isCoordinator: true })
                        ]
                    },
                    { name: 'Macueta Norte', staff: [createMedicalPerson('Roberto Sabha')] },
                    { name: 'San Pedrito', staff: [createMedicalPerson('Roberto Sabha')] }
                ]
            }
        ]
    },
    downstream: {
        id: 'downstream',
        title: 'Downstream',
        subtitle: 'Av. Alem, Refinería Campana y CORS',
        leader: 'Juan Martín Azcárate',
        leaderUid: MEDICAL_USER_UIDS['Juan Martín Azcárate'],
        leaderLabel: 'Líder Médico PAE',
        leaderManagementUnit: 'UG BA, Refinería Campana y CORS',
        icon: StructureIcons.Refinery,
        regions: [
            {
                id: 'ba',
                name: 'Edificio Av. Alem',
                sectors: [
                    {
                        name: 'Edificio Alem 1110',
                        staff: [
                            createMedicalPerson('Mario Bianchi', { role: 'Coordinador', isCoordinator: true }),
                            createMedicalPerson('José Carlini')
                        ]
                    }
                ]
            },
            {
                id: 'campana',
                name: 'Refinería Campana',
                sectors: [
                    {
                        name: 'Refinería Campana',
                        staff: [
                            createMedicalPerson('Mario Bianchi', { role: 'Coordinador', isCoordinator: true }),
                            createMedicalPerson('Betina Robledo')
                        ]
                    }
                ]
            },
            {
                id: 'cors',
                name: 'CORS',
                sectors: [
                    {
                        name: 'CORS',
                        staff: [
                            createMedicalPerson('Mario Bianchi', { role: 'Coordinador', isCoordinator: true }),
                            createMedicalPerson('José Carlini')
                        ]
                    }
                ]
            }
        ]
    },
    mpsa: {
        id: 'mpsa',
        title: 'Salud Ocupacional',
        subtitle: 'Brisa para MPSA / FSE',
        leader: 'Leandro Medina',
        leaderUid: MEDICAL_USER_UIDS['Leandro Medina'],
        leaderLabel: 'Líder Médico',
        leaderRole: 'Líder de Salud Ocupacional para MPSA / FSE',
        leaderBusinessUnit: 'Upstream',
        leaderManagementUnit: 'Golfo San Jorge y Neuquén',
        icon: StructureIcons.OccupationalHealth,
        regions: [
            {
                id: 'mpsa-gsj',
                name: 'Golfo San Jorge',
                sectors: [
                    { name: 'Médico de Base MPSA/FSE', staff: [createMedicalPerson('Leandro Medina'), createMedicalPerson('Willie Billie Mateo')] }
                ]
            },
            {
                id: 'mpsa-nqn',
                name: 'Neuquén',
                sectors: [
                    { name: 'Médico de Base MPSA/FSE', staff: [createMedicalPerson('Leandro Medina')] }
                ]
            }
        ]
    }
};

// --- RENDER LOGIC ---

document.addEventListener('DOMContentLoaded', () => {
    initMedicalStructure();
});

function initMedicalStructure() {
    const container = document.getElementById('structure-groups-container');
    const mainToggleBtn = document.getElementById('structure-main-toggle');
    const contentWrapper = document.getElementById('structure-content-wrapper');

    if (!container || !mainToggleBtn || !contentWrapper) return;

    // 1. Render Groups
    Object.values(medicalStructure).forEach(group => {
        container.appendChild(createGroupElement(group));
    });
    const structureRoot = document.getElementById('estructura-funcional') || contentWrapper;
    initStructureAvatarLightbox(structureRoot);
    hydrateStructureAvatars(structureRoot);

    // 2. Main Toggle Logic
    const lockMainExpanded = window.matchMedia('(max-width: 768px)').matches
        || window.matchMedia('(display-mode: standalone)').matches;
    let isMainExpanded = lockMainExpanded;

    const setMainExpanded = (expanded) => {
        isMainExpanded = expanded;
        mainToggleBtn.classList.toggle('expanded', expanded);
        contentWrapper.classList.toggle('expanded', expanded);
        mainToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');

        if (!expanded) {
            // Close all groups when collapsing main
            closeAllGroups();
        }
    };

    setMainExpanded(isMainExpanded);

    mainToggleBtn.addEventListener('click', (e) => {
        if (lockMainExpanded) {
            e.preventDefault();
            e.stopPropagation();
            setMainExpanded(true);
            return;
        }
        setMainExpanded(!isMainExpanded);
    });

    // Click outside to close active group (optional, based on React logic)
    document.addEventListener('click', (e) => {
        if (isMainExpanded && !contentWrapper.contains(e.target) && !mainToggleBtn.contains(e.target)) {
            closeAllGroups();
        }
    });
}

function escapeStructureAttribute(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getStructureInitials(name = '') {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'U';

    const pickLetter = (word = '') => Array.from(word.normalize('NFC')).find(char => /\p{L}/u.test(char)) || '';
    const first = pickLetter(words[0]);
    const second = pickLetter(words.length > 1 ? words[1] : words[0]);
    return `${first}${second}`.toLocaleUpperCase('es-AR') || 'U';
}

function renderStructureInitials(name = '') {
    return `<span class="structure-avatar__initials">${escapeStructureAttribute(getStructureInitials(name))}</span>`;
}

function renderStructureAvatar({
    className,
    name,
    uid,
    fallbackIcon,
    businessUnit,
    managementUnit,
    subsector,
    role
}) {
    const safeName = escapeStructureAttribute(name || 'Usuario');
    const safeUid = escapeStructureAttribute(uid || MEDICAL_USER_UIDS[name] || '');
    const uidAttr = safeUid ? ` data-dm-avatar-uid="${safeUid}"` : '';
    const metaAttrs = [
        ['data-dm-avatar-business', businessUnit],
        ['data-dm-avatar-management', managementUnit],
        ['data-dm-avatar-subsector', subsector],
        ['data-dm-avatar-role', role]
    ].map(([attr, value]) => {
        const safeValue = escapeStructureAttribute(value || '');
        return safeValue ? ` ${attr}="${safeValue}"` : '';
    }).join('');

    return `
        <div class="${className} structure-avatar"${uidAttr}${metaAttrs} data-dm-author="${safeName}" data-dm-avatar-name="${safeName}" data-dm-avatar-zoom>
            <img class="structure-avatar__img" data-dm-avatar-img alt="${safeName}" hidden>
            <span class="structure-avatar__fallback" data-dm-avatar-fallback aria-hidden="true">${fallbackIcon}</span>
        </div>
    `;
}

function createStructureAvatarContext({ group, region, sector, role, businessUnit, managementUnit } = {}) {
    return {
        businessUnit: businessUnit || group?.title || '',
        managementUnit: managementUnit || region?.name || group?.subtitle || '',
        subsector: sector?.name || '',
        role: role || ''
    };
}

function hydrateStructureAvatars(root = document) {
    if (!root) return;
    import('/assets/js/common/user-profiles.js?v=20260430-orgtree-avatars-1')
        .then(({ hydrateAvatars }) => hydrateAvatars(root))
        .catch((err) => {
            console.warn('No se pudieron hidratar avatares de estructura.', err);
        });
}

let structureAvatarLightbox = null;

function ensureStructureAvatarLightbox() {
    if (structureAvatarLightbox) return structureAvatarLightbox;

    const overlay = document.createElement('div');
    overlay.className = 'structure-avatar-lightbox';
    overlay.setAttribute('hidden', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <figure class="structure-avatar-lightbox__figure" role="dialog" aria-modal="true" aria-label="Avatar ampliado">
            <button class="structure-avatar-lightbox__close" type="button" aria-label="Cerrar avatar ampliado">&times;</button>
            <div class="structure-avatar-lightbox__image-wrap">
                <img class="structure-avatar-lightbox__img" alt="">
                <div class="structure-avatar-lightbox__fallback" hidden aria-hidden="true"></div>
            </div>
            <figcaption class="structure-avatar-lightbox__caption"></figcaption>
        </figure>
    `;
    document.body.appendChild(overlay);

    const image = overlay.querySelector('.structure-avatar-lightbox__img');
    const fallback = overlay.querySelector('.structure-avatar-lightbox__fallback');
    const caption = overlay.querySelector('.structure-avatar-lightbox__caption');
    const closeButton = overlay.querySelector('.structure-avatar-lightbox__close');

    const close = () => {
        overlay.setAttribute('hidden', '');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('dm-modal-open');
        if (image) {
            image.removeAttribute('src');
            image.alt = '';
            image.hidden = false;
        }
        if (fallback) {
            fallback.innerHTML = '';
            fallback.setAttribute('hidden', '');
        }
        if (caption) caption.replaceChildren();
    };

    overlay.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.target === overlay) close();
    });

    closeButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        close();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !overlay.hasAttribute('hidden')) {
            close();
        }
    });

    structureAvatarLightbox = {
        overlay,
        image,
        fallback,
        caption,
        close
    };

    return structureAvatarLightbox;
}

function getStructureAvatarMedia(avatarEl) {
    if (!avatarEl) return null;
    const image = avatarEl.querySelector('[data-dm-avatar-img], .structure-avatar__img');
    if (avatarEl.dataset?.hasAvatar === '1' && image && !image.hidden) {
        const src = image.currentSrc || image.src || '';
        if (src) {
            return {
                type: 'image',
                src,
                alt: image.alt || ''
            };
        }
    }

    const fallback = avatarEl.querySelector('[data-dm-avatar-fallback], .structure-avatar__fallback');
    const fallbackHtml = fallback?.innerHTML?.trim() || '';
    if (!fallbackHtml) return null;

    return {
        type: 'fallback',
        html: fallbackHtml,
        alt: avatarEl.dataset?.dmAvatarName || avatarEl.dataset?.dmAuthor || 'Avatar'
    };
}

function appendStructureAvatarCaptionRow(container, label, value) {
    if (!container || !value) return;

    const row = document.createElement('div');
    row.className = 'structure-avatar-lightbox__meta-row';

    const labelEl = document.createElement('dt');
    labelEl.textContent = label;

    const valueEl = document.createElement('dd');
    valueEl.textContent = value;

    row.append(labelEl, valueEl);
    container.appendChild(row);
}

function renderStructureAvatarCaption(caption, avatarEl, displayName) {
    if (!caption) return;

    caption.replaceChildren();

    const title = document.createElement('strong');
    title.className = 'structure-avatar-lightbox__name';
    title.textContent = displayName;
    caption.appendChild(title);

    const roleLines = (avatarEl.dataset.dmAvatarRoleLines || '')
        .split('|')
        .map(line => line.trim())
        .filter(Boolean);
    const isProfileCaption = roleLines.length > 0;
    caption.classList.toggle('structure-avatar-lightbox__caption--profile', isProfileCaption);
    if (roleLines.length) {
        const roles = document.createElement('div');
        roles.className = 'structure-avatar-lightbox__roles';
        roleLines.forEach(line => {
            const lineEl = document.createElement('span');
            lineEl.className = 'structure-avatar-lightbox__role-line';
            lineEl.textContent = line;
            roles.appendChild(lineEl);
        });
        caption.appendChild(roles);
    } else {
        const role = avatarEl.dataset.dmAvatarRole || '';
        if (role) {
            const roleEl = document.createElement('span');
            roleEl.className = 'structure-avatar-lightbox__role';
            roleEl.textContent = role;
            caption.appendChild(roleEl);
        }
    }

    const meta = document.createElement('dl');
    meta.className = 'structure-avatar-lightbox__meta';
    if (isProfileCaption) {
        meta.classList.add('structure-avatar-lightbox__meta--profile');
    }
    appendStructureAvatarCaptionRow(meta, 'Operaciones', avatarEl.dataset.dmAvatarBusiness);
    appendStructureAvatarCaptionRow(meta, 'Unidad de gestión', avatarEl.dataset.dmAvatarManagement);
    appendStructureAvatarCaptionRow(meta, 'Sector', avatarEl.dataset.dmAvatarSubsector);

    if (meta.children.length) caption.appendChild(meta);
}

function openStructureAvatarLightbox(avatarEl) {
    const sourceMedia = getStructureAvatarMedia(avatarEl);
    if (!sourceMedia) return;

    const modal = ensureStructureAvatarLightbox();
    const displayName =
        avatarEl.dataset.dmAvatarName ||
        avatarEl.dataset.dmAuthor ||
        sourceMedia.alt ||
        'Avatar';

    if (sourceMedia.type === 'image' && modal.image) {
        modal.image.hidden = false;
        modal.image.src = sourceMedia.src;
        modal.image.alt = displayName;
        modal.fallback?.setAttribute('hidden', '');
        if (modal.fallback) modal.fallback.innerHTML = '';
    } else if (sourceMedia.type === 'fallback' && modal.fallback) {
        if (modal.image) {
            modal.image.removeAttribute('src');
            modal.image.alt = '';
            modal.image.hidden = true;
        }
        modal.fallback.innerHTML = sourceMedia.html;
        modal.fallback.removeAttribute('hidden');
    }
    renderStructureAvatarCaption(modal.caption, avatarEl, displayName);

    modal.overlay.removeAttribute('hidden');
    modal.overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dm-modal-open');
}

function initStructureAvatarLightbox(root = document) {
    const scope = root || document;
    if (!scope || scope.dataset?.structureAvatarLightboxBound === '1') return;
    if (scope.dataset) scope.dataset.structureAvatarLightboxBound = '1';

    scope.addEventListener('click', (event) => {
        const avatarEl = event.target.closest?.('[data-dm-avatar-zoom]');
        if (!avatarEl || !scope.contains(avatarEl)) return;

        event.preventDefault();
        event.stopPropagation();
        openStructureAvatarLightbox(avatarEl);
    }, true);
}

function createGroupElement(group) {
    const groupCard = document.createElement('div');
    groupCard.className = 'group-card';
    groupCard.dataset.groupId = group.id;
    groupCard.setAttribute('aria-expanded', 'false');

    // HTML Template
    groupCard.innerHTML = `
        <div class="group-accent-bar"></div>
        <button class="group-header-btn">
            <div class="group-title-wrapper">
                <div class="group-icon-circle">
                    ${group.icon}
                </div>
                <div class="group-title-text">
                    <h2>
                        ${group.title}
                    </h2>
                    ${group.subtitle ? `<p class="group-subtitle">${group.subtitle}</p>` : ''}
                </div>
            </div>
            
            <div class="group-leader-badge">
                ${renderStructureAvatar({
                    className: 'leader-icon-circle',
                    name: group.leader,
                    uid: group.leaderUid,
                    fallbackIcon: StructureIcons.UserLarge,
                    ...createStructureAvatarContext({
                        group,
                        role: group.leaderRole || group.leaderLabel || 'Líder Médico',
                        businessUnit: group.leaderBusinessUnit,
                        managementUnit: group.leaderManagementUnit
                    })
                })}
                <div class="leader-info">
                    <span class="leader-label">${group.leaderLabel || 'Líder Médico'}</span>
                    <span class="leader-name">${group.leader}</span>
                </div>
            </div>
            <span class="group-chevron" aria-hidden="true">${StructureIcons.ChevronDown}</span>
        </button>

        <div class="group-content">
            <div class="group-content-inner">
                <div class="regions-stack" id="regions-container-${group.id}">
                    <!-- Regions injected here -->
                </div>
            </div>
        </div>
    `;

    // Inject Regions
    const regionsContainer = groupCard.querySelector(`#regions-container-${group.id}`);
    group.regions.forEach(region => {
        regionsContainer.appendChild(createRegionElement(region, group));
    });

    // Toggle Logic
    const headerBtn = groupCard.querySelector('.group-header-btn');
    const content = groupCard.querySelector(':scope > .group-content');
    const contentId = `group-content-${group.id}`;
    if (content) content.id = contentId;
    headerBtn.setAttribute('aria-expanded', 'false');
    headerBtn.setAttribute('aria-controls', contentId);

    headerBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent bubbling
        const isOpen = groupCard.classList.contains('active-group') || content.classList.contains('open') || headerBtn.getAttribute('aria-expanded') === 'true';
        closeAllGroups();
        if (!isOpen) {
            setGroupOpen(groupCard, true);
        }
    });

    return groupCard;
}

function isHierarchicalMobileView() {
    return window.matchMedia('(max-width: 640px)').matches;
}

function splitRegionSectors(sectors = []) {
    const sectorsWithStaff = (Array.isArray(sectors) ? sectors : []).filter(
        sector => Array.isArray(sector?.staff) && sector.staff.length > 0
    );

    const coordinationSectors = [];
    const operationalSectors = [];

    sectorsWithStaff.forEach(sector => {
        const onlyCoordinators = sector.staff.every(person => person?.isCoordinator);
        if (onlyCoordinators) {
            coordinationSectors.push(sector);
            return;
        }
        operationalSectors.push(sector);
    });

    return { coordinationSectors, operationalSectors };
}

function extractRegionalCoordinators(coordinationSectors = []) {
    const seen = new Set();

    return coordinationSectors
        .flatMap(sector => (sector.staff || []).map(person => ({ person, sector })))
        .filter(({ person }) => {
            const key = `${person.name}|${person.role || ''}|${person.isCoordinator ? '1' : '0'}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function createRegionElement(region, group) {
    const regionWrapper = document.createElement('div');
    regionWrapper.className = 'region-accordion';
    const useHierarchicalMobile = isHierarchicalMobileView();
    const { coordinationSectors, operationalSectors } = splitRegionSectors(region.sectors);

    regionWrapper.innerHTML = `
        <button class="region-btn">
            <div class="region-info">
                <div class="region-icon-box">
                    ${StructureIcons.Building2}
                </div>
                <span class="region-name">${region.name}</span>
            </div>
            <span class="region-chevron">${StructureIcons.ChevronRight}</span>
        </button>

        <div class="group-content"> <!-- Reusing group-content class for animation -->
            <div class="group-content-inner">
                <div class="region-structure">
                    <div class="region-coordination-slot" id="region-coordination-${region.id}"></div>
                    <div class="sectors-container">
                    <div class="sectors-list">
                        <div class="sectors-inner" id="sectors-list-${region.id}">
                            <!-- Sectors injected here -->
                        </div>
                    </div>
                </div>
                </div>
            </div>
        </div>
    `;

    const coordinationSlot = regionWrapper.querySelector(`#region-coordination-${region.id}`);
    const sectorsList = regionWrapper.querySelector(`#sectors-list-${region.id}`);
    const sectorsContainer = regionWrapper.querySelector('.sectors-container');

    if (useHierarchicalMobile && coordinationSectors.length && coordinationSlot) {
        const coordinationBlock = createRegionCoordinationBlock(region, coordinationSectors, group);
        if (coordinationBlock) {
            coordinationSlot.appendChild(coordinationBlock);
            coordinationSlot.classList.add('has-content');
        }
    }

    const sectorsToRender = useHierarchicalMobile ? operationalSectors : region.sectors;
    const visibleSectors = (Array.isArray(sectorsToRender) ? sectorsToRender : []).filter(
        sector => Array.isArray(sector?.staff) && sector.staff.length > 0
    );

    if (useHierarchicalMobile && !visibleSectors.length && sectorsContainer) {
        sectorsContainer.classList.add('is-empty');
    }

    visibleSectors.forEach(sector => {
        sectorsList.appendChild(createSectorElement(sector, { group, region }));
    });

    // Toggle Logic
    const btn = regionWrapper.querySelector('.region-btn');
    btn.setAttribute('aria-expanded', 'false');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();

    const wasOpen = regionWrapper.classList.contains('open');
    const parentGroup = regionWrapper.closest('.group-content-inner');
    const siblingRegions = parentGroup.querySelectorAll('.region-accordion');

    siblingRegions.forEach(sib => setRegionOpen(sib, false));
    if (!wasOpen) setRegionOpen(regionWrapper, true);
  });

    return regionWrapper;
}

function createRegionCoordinationBlock(region, coordinationSectors = [], group) {
    const coordinatorRecords = extractRegionalCoordinators(coordinationSectors);
    if (!coordinatorRecords.length) return null;

    const block = document.createElement('section');
    block.className = 'region-coordination-block';
    block.innerHTML = `
        <div class="coordination-grid" data-count="${coordinatorRecords.length}">
            <!-- Coordinators injected here -->
        </div>
    `;

    const grid = block.querySelector('.coordination-grid');
    coordinatorRecords.forEach(({ person, sector }) => {
        grid.appendChild(createCoordinationCard(person, { group, region, sector }));
    });

    return block;
}

function createCoordinationCard(person, context = {}) {
    const card = document.createElement('article');
    card.className = 'coordination-card';
    card.innerHTML = `
        ${renderStructureAvatar({
            className: 'coordination-card__icon',
            name: person.name,
            uid: person.uid,
            fallbackIcon: StructureIcons.ClipboardCheck,
            ...createStructureAvatarContext({
                ...context,
                role: person.role || 'Coordinador'
            })
        })}
        <div class="coordination-card__info">
            <span class="coordination-card__name">${person.name}</span>
            <span class="coordination-card__role">${person.role || 'Coordinador'}</span>
        </div>
    `;

    return card;
}

function classifySectorLayout(staff = []) {
    const staffCount = Array.isArray(staff) ? staff.length : 0;

    if (staffCount !== 2) {
        return {
            layout: 'stack',
            pairKind: 'none',
            staffCount
        };
    }

    const coordinatorCount = staff.filter(person => person?.isCoordinator).length;

    if (coordinatorCount === 2) {
        return {
            layout: 'peer-pair',
            pairKind: 'coordinator',
            staffCount
        };
    }

    if (coordinatorCount === 0) {
        return {
            layout: 'peer-pair',
            pairKind: 'staff',
            staffCount
        };
    }

    return {
        layout: 'stack',
        pairKind: 'mixed',
        staffCount
    };
}

function createSectorElement(sector, context = {}) {
    if (!sector.staff || sector.staff.length === 0) return document.createElement('div');

    const { layout, pairKind, staffCount } = classifySectorLayout(sector.staff);

    if (isHierarchicalMobileView()) {
        return createMobileSectorElement(sector, { layout, pairKind, staffCount, ...context });
    }

    const sectorDiv = document.createElement('div');
    sectorDiv.className = 'sector-item';

    sectorDiv.innerHTML = `
        <h4 class="sector-title">
            ${StructureIcons.MapPin}
            ${sector.name}
        </h4>
        <div
            class="staff-grid"
            id="staff-grid-${sector.name.replace(/\s+/g, '-')}"
            data-layout="${layout}"
            data-pair-kind="${pairKind}"
            data-staff-count="${staffCount}"
        >
            <!-- Staff injected here -->
        </div>
    `;

    const staffGrid = sectorDiv.querySelector('.staff-grid');
    sector.staff.forEach(person => {
        staffGrid.appendChild(createStaffBadge(person, { ...context, sector }));
    });

    return sectorDiv;
}

function createMobileSectorElement(sector, { layout, pairKind, staffCount, group, region }) {
    const sectorDiv = document.createElement('div');
    sectorDiv.className = 'sector-item sector-item--card';

    sectorDiv.innerHTML = `
        <article class="sector-card">
            <div class="sector-card__header">
                <h4 class="sector-card__title">${sector.name}</h4>
            </div>
            <div class="sector-card__body">
                <div
                    class="staff-grid"
                    id="staff-grid-${sector.name.replace(/\s+/g, '-')}"
                    data-layout="${layout}"
                    data-pair-kind="${pairKind}"
                    data-staff-count="${staffCount}"
                >
                    <!-- Staff injected here -->
                </div>
            </div>
        </article>
    `;

    const staffGrid = sectorDiv.querySelector('.staff-grid');
    sector.staff.forEach(person => {
        staffGrid.appendChild(createStaffBadge(person, { group, region, sector }));
    });

    return sectorDiv;
}

function createStaffBadge(person, context = {}) {
    const badge = document.createElement('div');
    const isCoord = person.isCoordinator;

    badge.className = `staff-badge ${isCoord ? 'coordinator' : ''}`;
    const fallbackIcon = isCoord ? StructureIcons.ClipboardCheck : renderStructureInitials(person.name);

    badge.innerHTML = `
        ${renderStructureAvatar({
            className: `staff-icon-circle${isCoord ? '' : ' staff-icon-circle--initials'}`,
            name: person.name,
            uid: person.uid,
            fallbackIcon,
            ...createStructureAvatarContext({
                ...context,
                role: person.role || ''
            })
        })}
        <div class="staff-info">
            <span class="staff-name">${person.name}</span>
            ${isCoord ? `<span class="staff-role">${person.role}</span>` : ''}
        </div>
    `;

    return badge;
}

function closeAllGroups() {
    const allGroups = document.querySelectorAll('.group-card');
    allGroups.forEach(g => {
        setGroupOpen(g, false);
    });
}

function setGroupOpen(groupCard, open) {
    const headerBtn = groupCard.querySelector('.group-header-btn');
    const content = groupCard.querySelector(':scope > .group-content');
    if (!headerBtn || !content) return;

    content.classList.toggle('open', open);
    groupCard.classList.toggle('active-group', open);
    groupCard.setAttribute('aria-expanded', open ? 'true' : 'false');
    headerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (!open) {
        groupCard.querySelectorAll('.region-accordion').forEach(r => setRegionOpen(r, false));
    }
}

function setRegionOpen(regionAccordion, open) {
    const content = regionAccordion.querySelector(':scope > .group-content');
    const btn = regionAccordion.querySelector(':scope > .region-btn');
    if (!content || !btn) return;

    regionAccordion.classList.toggle('open', open);
    content.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
