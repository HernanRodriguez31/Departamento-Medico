/* Main JavaScript */

document.addEventListener('DOMContentLoaded', () => {
    console.log('Departamento Médico website loaded');

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

        let pinchActive = false
        const preventPinchMove = (event) => {
            if (event.touches && event.touches.length > 1 && event.cancelable) {
                event.preventDefault()
            }
        }
        const handlePinchStart = (event) => {
            if (!event.touches || event.touches.length < 2 || pinchActive) return
            pinchActive = true
            document.addEventListener('touchmove', preventPinchMove, { passive: false })
        }
        const handlePinchEnd = (event) => {
            const touches = event.touches ? event.touches.length : 0
            if (pinchActive && touches < 2) {
                pinchActive = false
                document.removeEventListener('touchmove', preventPinchMove)
            }
        }

        document.addEventListener('touchstart', handlePinchStart, { passive: true })
        document.addEventListener('touchend', handlePinchEnd, { passive: true })
        document.addEventListener('touchcancel', handlePinchEnd, { passive: true })

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

    if (window.__DM_ENABLE_LEGACY_ZOOM_GUARD__ === true) {
        disableZoomGestures()
    }

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
    const bottomNavItems = bottomNav ? Array.from(bottomNav.querySelectorAll('[data-route]')) : []
    const appShellQuery = window.matchMedia('(max-width: 768px)')
    const swipeQuery = window.matchMedia('(max-width: 640px)')
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)')
    const displayModeQuery = window.matchMedia('(display-mode: standalone)')
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const muroComposer = document.getElementById('dm-muro-composer')
    const mainEl = document.querySelector('main.main')
    const appRootEl = document.getElementById('app')

    if (typeof window.__DM_DEBUG_STANDALONE_SCROLL !== 'boolean') {
        window.__DM_DEBUG_STANDALONE_SCROLL = false
    }

    const MOBILE_VIEWS = ['muro', 'estructura', 'ia', 'comites', 'foro']
    const VIEW_HASH = {
        muro: 'carrete',
        estructura: 'estructura',
        ia: 'ia',
        comites: 'comites',
        foro: 'foro'
    }
    const HASH_ALIAS_TO_VIEW = {
        carrete: 'muro',
        muro: 'muro',
        estructura: 'estructura',
        'estructura-funcional': 'estructura',
        comites: 'comites',
        foro: 'foro',
        ia: 'ia',
        evidencia: 'ia',
        investigacion: 'ia',
        'galeria-operativa': 'muro'
    }
    const MOBILE_VIEW_ROOTS = {
        muro: ['#carrete'],
        estructura: ['#estructura-hero', '#estructura-funcional'],
        ia: [],
        comites: ['#comites'],
        foro: ['#foro']
    }
    const PAGER_ORDER = ['muro', 'estructura', 'ia', 'comites', 'foro']
    const PAGER_TOUCH_HORIZONTAL_PX = 10
    const PAGER_TOUCH_VERTICAL_PX = 32
    const PAGER_TOUCH_HORIZONTAL_RATIO = 1.25
    const PAGER_TOUCH_VERTICAL_RATIO = 1.6
    const PAGER_TOUCH_COMMIT_PX = 52
    const PAGER_MOUSE_COMMIT_PX = 14
    const PAGER_TOUCH_SWIPE_RATIO = 0.28
    const PAGER_WHEEL_HORIZONTAL_PX = 36
    const PAGER_WHEEL_HORIZONTAL_RATIO = 1.35
    const PAGER_WHEEL_GESTURE_GAP_MS = 180
    const PAGER_WHEEL_LOCK_MS = 520

    const rootStyle = document.documentElement.style
    let rafLayout = 0
    let currentViewId = 'muro'
    let lastNonIaViewId = 'muro'
    const scrollByView = new Map()
    const pagerState = {
        enabled: false,
        shellEl: null,
        viewportEl: null,
        trackEl: null,
        trackInnerEl: null,
        assistantHostEl: null,
        pagesByKey: new Map(),
        realPagesByView: new Map(),
        scrollersByView: new Map(),
        anchors: [],
        stashedNodes: [],
        pageIndex: 0,
        dragX: 0,
        isProgrammaticPagerScroll: false,
        programmaticTargetViewId: null,
        touchActive: false,
        touchIntent: 'idle',
        gestureSource: 'idle',
        pointerId: null,
        touchStartX: 0,
        touchStartY: 0,
        touchStartIndex: -1,
        touchTargetIndex: null,
        touchLastX: 0,
        touchLastY: 0,
        pendingPointerTouch: null,
        lastGestureAxis: 'idle',
        lastSettledIndex: -1,
        pagerController: null,
        programmaticStartedAt: 0,
        programmaticSource: '',
        lastGestureSource: 'idle',
        lastGestureEndReason: '',
        lastIgnoredTarget: '',
        lastDx: 0,
        lastDy: 0,
        wheelAccumX: 0,
        wheelAccumY: 0,
        wheelLastAt: 0,
        wheelLockUntil: 0,
        suppressNextClick: false
    }

    const isStandalonePwa = () =>
        displayModeQuery.matches || window.navigator.standalone === true

    const getElementDebugLabel = (el) => {
        if (!el) return null
        if (el === window) return 'window'
        if (el === document.documentElement) return 'html'
        if (el === document.body) return 'body'
        const tag = String(el.tagName || '').toLowerCase()
        const id = el.id ? `#${el.id}` : ''
        const className = typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
            : ''
        return `${tag}${id}${className ? `.${className}` : ''}`
    }

    const syncStandaloneRootState = () => {
        const standalone = isStandalonePwa()
        document.documentElement.classList.toggle('is-standalone-pwa', standalone)
        if (document.body) {
            document.body.classList.toggle('is-standalone-pwa', standalone)
        }
        return standalone
    }

    const syncStandaloneViewportVar = () => {
        const viewportHeight = Math.round(
            window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0
        )
        if (viewportHeight > 0) {
            rootStyle.setProperty('--dm-app-vh', `${viewportHeight}px`)
        }
    }

    const debugStandaloneScrollState = (source = 'debug') => {
        if (!window.__DM_DEBUG_STANDALONE_SCROLL) return
        const activeScrollEl = document.body?.dataset?.view
            ? getViewScrollContainer(getCurrentViewId())
            : null
        const visualViewport = window.visualViewport
        const payload = {
            source,
            isStandalone: isStandalonePwa(),
            navigatorStandalone: window.navigator.standalone === true,
            currentViewId: document.body?.dataset?.view || getCurrentViewId(),
            scrollingElement: getElementDebugLabel(document.scrollingElement),
            htmlScrollTop: document.documentElement.scrollTop || 0,
            bodyScrollTop: document.body?.scrollTop || 0,
            appRoot: {
                label: getElementDebugLabel(appRootEl),
                scrollTop: appRootEl?.scrollTop || 0
            },
            main: {
                label: getElementDebugLabel(mainEl),
                scrollTop: mainEl?.scrollTop || 0
            },
            activeViewScroller: {
                label: getElementDebugLabel(activeScrollEl),
                scrollTop: activeScrollEl === window
                    ? (window.scrollY || 0)
                    : (activeScrollEl?.scrollTop || 0)
            },
            pagerTrack: {
                label: getElementDebugLabel(pagerState.trackEl),
                scrollLeft: pagerState.trackEl?.scrollLeft || 0
            },
            viewport: {
                innerHeight: window.innerHeight,
                visualHeight: visualViewport?.height || null,
                visualOffsetTop: visualViewport?.offsetTop || 0
            }
        }
        console.debug('[DM standalone scroll]', payload)
    }

    function syncAppShellVars() {
        if (!(appShellQuery.matches || isStandalonePwa())) return

        const headerEl = document.querySelector('.header')
        const headerH = headerEl ? Math.round(headerEl.getBoundingClientRect().height) : 0
        const composerH = muroComposer ? Math.round(muroComposer.getBoundingClientRect().height) : 0

        if (headerH > 0) rootStyle.setProperty('--app-header-h', `${headerH}px`)
        if (bottomNav) {
            const navVar = parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue('--bottom-nav-h')
            )
            if (navVar > 0) {
                rootStyle.setProperty('--app-tabbar-height', `${Math.round(navVar)}px`)
            }
        }
        if (composerH > 0) {
            rootStyle.setProperty('--dm-muro-offset', `${composerH}px`)
        }
    }

    function scheduleSyncAppShellVars() {
        if (rafLayout) cancelAnimationFrame(rafLayout)
        rafLayout = requestAnimationFrame(() => {
            rafLayout = 0
            syncStandaloneViewportVar()
            syncAppShellVars()
        })
    }

    const isAppShell = () => appShellQuery.matches || isStandalonePwa()
    const hasTouchInput = () => navigator.maxTouchPoints > 0 || 'ontouchstart' in window
    const isSwipeRuntime = () => isAppShell()
        && swipeQuery.matches
        && (
            coarsePointerQuery.matches ||
            hasTouchInput() ||
            Boolean(window.PointerEvent)
        )
    const prefersReducedMotion = () => reducedMotionQuery.matches
    const carreteSection = document.getElementById('carrete')
    const carouselHeader = carreteSection ? carreteSection.querySelector('.dm-carousel-header') : null
    const carouselViewport = carreteSection ? carreteSection.querySelector('.dm-carousel-viewport') : null
    const carouselHeaderAnchor = carouselHeader ? document.createComment('dm-carousel-header-anchor') : null
    const resetMuroHorizontalOffset = () => {
        const targets = [carouselViewport, mainEl, document.documentElement, document.body]
        targets.forEach((el) => {
            if (!el || typeof el.scrollLeft !== 'number') return
            el.scrollLeft = 0
        })
    }
    const scheduleResetMuroOffset = () => {
        requestAnimationFrame(() => {
            resetMuroHorizontalOffset()
            requestAnimationFrame(resetMuroHorizontalOffset)
        })
    }

    const normalizeViewId = (value) => {
        const raw = String(value || '')
            .replace(/^#/, '')
            .trim()
            .toLowerCase()
        return HASH_ALIAS_TO_VIEW[raw] || 'muro'
    }
    const getCurrentViewId = () => normalizeViewId(currentViewId || window.location.hash || 'muro')
    const getViewIndex = (viewId) => MOBILE_VIEWS.indexOf(normalizeViewId(viewId))
    const getNextViewId = (viewId) => {
        const idx = getViewIndex(viewId)
        return MOBILE_VIEWS[(idx + 1 + MOBILE_VIEWS.length) % MOBILE_VIEWS.length]
    }
    const getPrevViewId = (viewId) => {
        const idx = getViewIndex(viewId)
        return MOBILE_VIEWS[(idx - 1 + MOBILE_VIEWS.length) % MOBILE_VIEWS.length]
    }
    const getCanonicalHashForView = (viewId) => VIEW_HASH[normalizeViewId(viewId)] || VIEW_HASH.muro
    const getBodyRouteForView = (viewId) => {
        const normalized = normalizeViewId(viewId)
        return normalized === 'muro' ? 'carrete' : normalized
    }
    const getPagerRealIndex = (viewId) => {
        const normalized = normalizeViewId(viewId)
        return PAGER_ORDER.indexOf(normalized)
    }
    const getViewIdFromPagerIndex = (index) => {
        const viewId = PAGER_ORDER[index] || PAGER_ORDER[getPagerRealIndex(currentViewId)]
        return viewId ? normalizeViewId(viewId) : 'muro'
    }
    const getViewNodes = (viewId) => {
        const selectors = MOBILE_VIEW_ROOTS[normalizeViewId(viewId)] || []
        return selectors
            .map((selector) => document.querySelector(selector))
            .filter(Boolean)
    }
    const getAssistantShellApi = () => window.__dmAssistantShell || null
    const getAssistantShellElements = () => {
        const shell = document.querySelector('[data-dm-ai-shell]')
        if (!shell) return null
        return {
            shell,
            backdrop: shell.querySelector('[data-dm-ai-backdrop]'),
            panel: shell.querySelector('.dm-ai-panel'),
            header: shell.querySelector('[data-dm-ai-header]')
        }
    }

    const isPagerMode = () => pagerState.enabled && !!pagerState.trackEl?.isConnected

    const getPagerPageWidth = () => {
        const firstPageWidth =
            pagerState.trackEl?.querySelector?.('.dm-mobile-page')
                ?.getBoundingClientRect?.().width || 0
        const trackWidth =
            pagerState.trackEl?.getBoundingClientRect?.().width ||
            pagerState.trackEl?.clientWidth ||
            0
        const rectWidth = pagerState.viewportEl?.getBoundingClientRect?.().width || 0
        const viewportWidth = window.visualViewport?.width || window.innerWidth || 0
        return Math.max(firstPageWidth, trackWidth, rectWidth, viewportWidth)
    }

    const getViewScrollContainer = (viewId) => {
        const normalized = normalizeViewId(viewId)
        if (isPagerMode()) {
            if (normalized === 'ia') return null
            if (normalized === 'muro') return pagerState.scrollersByView.get('muro') || null
            if (normalized === 'foro') {
                return pagerState.realPagesByView.get('foro')
                    ?.querySelector?.('#forum-messages-general')
                    || pagerState.scrollersByView.get('foro')
                    || null
            }
            return pagerState.scrollersByView.get(normalized) || null
        }
        if (normalized === 'ia') return null
        if (normalized === 'muro') {
            const viewport = document.querySelector('#carrete .dm-carousel-viewport')
            const section = document.getElementById('carrete')
            if (section?.classList.contains('is-feed-mode') && viewport) return viewport
            return mainEl
        }
        if (normalized === 'foro') {
            return document.querySelector('#forum-messages-general')
                || document.querySelector('#foro > .section-card')
                || mainEl
        }
        return mainEl
    }

    const getStoredScrollTop = (viewId) => {
        const normalized = normalizeViewId(viewId)
        const stored = scrollByView.get(normalized)
        return typeof stored === 'number' ? stored : 0
    }

    const getActiveScrollTop = (viewId) => {
        const el = getViewScrollContainer(viewId)
        if (!el) return 0
        if (el === window) return window.scrollY || 0
        return el.scrollTop || 0
    }

    const saveScrollForView = (viewId) => {
        const normalized = normalizeViewId(viewId)
        if (normalized === 'ia') return
        scrollByView.set(normalized, getActiveScrollTop(normalized))
    }

    const restoreScrollForView = (viewId) => {
        const normalized = normalizeViewId(viewId)
        if (normalized === 'ia') return
        const scrollEl = getViewScrollContainer(normalized)
        const nextTop = getStoredScrollTop(normalized)
        if (!scrollEl) return
        requestAnimationFrame(() => {
            if (scrollEl === window) {
                window.scrollTo({ top: nextTop, behavior: 'auto' })
                return
            }
            scrollEl.scrollTop = nextTop
        })
    }

    const syncMuroHeaderPlacement = () => {
        if (!carreteSection || !carouselHeader || !carouselViewport || !carouselHeaderAnchor) return

        const shouldInlineHeader = isAppShell()
            && !isPagerMode()
            && document.body?.dataset?.view === 'carrete'
            && carreteSection.classList.contains('is-feed-mode')

        if (shouldInlineHeader) {
            if (carouselHeader.parentNode !== carouselViewport) {
                if (!carouselHeaderAnchor.parentNode && carouselHeader.parentNode) {
                    carouselHeader.parentNode.insertBefore(carouselHeaderAnchor, carouselHeader)
                }
                carouselViewport.insertBefore(carouselHeader, carouselViewport.firstChild)
            }
            scheduleResetMuroOffset()
            return
        }

        if (carouselHeaderAnchor.parentNode && carouselHeader.parentNode !== carouselHeaderAnchor.parentNode) {
            carouselHeaderAnchor.parentNode.insertBefore(carouselHeader, carouselHeaderAnchor.nextSibling)
        }
        scheduleResetMuroOffset()
    }

    const syncForoLayoutVars = () => {
        const clearForoVars = () => {
            document.querySelectorAll('#foro').forEach((el) => {
                el.style.removeProperty('--dm-foro-header-block')
            })
        }

        if (!isAppShell()) {
            clearForoVars()
            return
        }

        let foroRoot = null
        if (isPagerMode()) {
            const activeForoPage = [...document.querySelectorAll('.dm-mobile-page')].find((pageEl) => {
                if (normalizeViewId(pageEl.dataset.view) !== 'foro') return false
                const rect = pageEl.getBoundingClientRect()
                return Math.round(rect.left) === 0 && rect.right > 0
            })
            foroRoot = activeForoPage?.querySelector('#foro') || null
        } else if (getCurrentViewId() === 'foro' || String(document.body?.dataset?.view || '').trim().toLowerCase() === 'foro') {
            foroRoot = document.getElementById('foro')
        }

        if (!foroRoot) {
            clearForoVars()
            return
        }

        const header = foroRoot.querySelector('.dm-foro-header')
        if (!header) return
        const headerHeight = Math.round(header.getBoundingClientRect().height || 0)
        if (!headerHeight) return
        foroRoot.style.setProperty('--dm-foro-header-block', `${headerHeight}px`)
    }

    const updateNavState = (viewId) => {
        if (!bottomNavItems.length) return
        const activeViewId = normalizeViewId(viewId)
        bottomNavItems.forEach((item) => {
            const itemViewId = normalizeViewId(item.dataset.route)
            const isActive = itemViewId === activeViewId
            item.classList.toggle('is-active', isActive)
            if (item.tagName === 'BUTTON') {
                item.setAttribute('aria-pressed', isActive ? 'true' : 'false')
                return
            }
            if (isActive) {
                item.setAttribute('aria-current', 'page')
            } else {
                item.removeAttribute('aria-current')
            }
        })
    }

    const emitViewChange = ({ viewId, previousViewId, source, direction = 0, historyMode = 'none' }) => {
        window.dispatchEvent(
            new CustomEvent('dm:viewchange', {
                detail: {
                    viewId,
                    routeHash: getCanonicalHashForView(viewId),
                    bodyView: getBodyRouteForView(viewId),
                    previousViewId,
                    source,
                    direction,
                    historyMode
                }
            })
        )
    }

    const syncAssistantShellForView = (viewId) => {
        const assistantShell = getAssistantShellApi()
        if (!assistantShell) return
        if (isPagerMode()) {
            if (normalizeViewId(viewId) === 'ia') {
                const model = assistantShell.state?.activeModel || 'gemini'
                Promise.resolve(assistantShell.openChat(model, { context: 'app' })).catch(() => {})
            } else if (assistantShell.state?.pickerOpen) {
                assistantShell.closePicker()
            }
            return
        }
        if (normalizeViewId(viewId) === 'ia') {
            const model = assistantShell.state?.activeModel || 'gemini'
            Promise.resolve(assistantShell.openChat(model, { context: 'app' })).catch(() => {})
            if (assistantShell.state?.pickerOpen) {
                assistantShell.closePicker()
            }
            return
        }
        if (assistantShell.state?.panelOpen) assistantShell.closeChat()
        if (assistantShell.state?.pickerOpen) assistantShell.closePicker()
    }

    const updateHistoryForView = (viewId, historyMode, routeChanged) => {
        if (historyMode === 'none') return
        const hash = `#${getCanonicalHashForView(viewId)}`
        const shouldReplace = historyMode === 'replace' || !routeChanged
        if (!shouldReplace && window.location.hash === hash) return
        history[shouldReplace ? 'replaceState' : 'pushState']({ dmView: viewId }, '', hash)
    }

    const navigateToView = (targetViewId, {
        source = 'router',
        direction = 0,
        historyMode = 'push',
        forceEmit = false
    } = {}) => {
        const normalizedTarget = normalizeViewId(targetViewId)
        const previousViewId = getCurrentViewId()
        const routeChanged = normalizedTarget !== previousViewId
        const nextHash = getCanonicalHashForView(normalizedTarget)
        const shouldCanonicalize = window.location.hash !== `#${nextHash}`
        const effectiveHistoryMode = historyMode === 'push' && !routeChanged ? 'replace' : historyMode

        if (!isAppShell()) {
            currentViewId = normalizedTarget
            document.body.removeAttribute('data-view')
            updateNavState(normalizedTarget)
            return false
        }

        if (routeChanged && previousViewId !== 'ia') {
            saveScrollForView(previousViewId)
        }
        if (normalizedTarget !== 'ia') {
            lastNonIaViewId = normalizedTarget
        }

        currentViewId = normalizedTarget
        document.body.dataset.view = getBodyRouteForView(normalizedTarget)
        updateNavState(normalizedTarget)
        scheduleSyncAppShellVars()
        syncMuroHeaderPlacement()
        requestAnimationFrame(syncForoLayoutVars)
        if (normalizedTarget === 'muro') {
            scheduleResetMuroOffset()
        }

        if (effectiveHistoryMode !== 'none' && (routeChanged || shouldCanonicalize)) {
            updateHistoryForView(normalizedTarget, effectiveHistoryMode, routeChanged)
        }

        syncAssistantShellForView(normalizedTarget)

        if (routeChanged && normalizedTarget !== 'ia') {
            restoreScrollForView(normalizedTarget)
        }

        if (
            isPagerMode()
            && source !== 'pager'
            && source !== 'pager-wrap-jump'
            && source !== 'pager-sync'
        ) {
            const pagerBehavior = prefersReducedMotion()
                ? 'auto'
                : 'smooth'
            scrollPagerToView(normalizedTarget, {
                behavior: pagerBehavior,
                source
            })
        }

        if (routeChanged || shouldCanonicalize || forceEmit) {
            emitViewChange({
                viewId: normalizedTarget,
                previousViewId,
                source,
                direction,
                historyMode: effectiveHistoryMode
            })
        }

        return routeChanged || shouldCanonicalize
    }

    const syncViewFromLocation = ({ source = 'location-sync', allowCanonicalReplace = true, forceEmit = false } = {}) => {
        const rawHash = String(window.location.hash || '').replace(/^#/, '').trim().toLowerCase()
        const viewId = normalizeViewId(rawHash || 'muro')
        const needsCanonicalHash = !rawHash || rawHash !== getCanonicalHashForView(viewId)
        navigateToView(viewId, {
            source,
            historyMode: allowCanonicalReplace && needsCanonicalHash ? 'replace' : 'none',
            forceEmit
        })
    }

    const handleShellChange = () => {
        syncStandaloneRootState()
        syncStandaloneViewportVar()
        syncViewFromLocation({ source: 'shell-breakpoint', allowCanonicalReplace: true, forceEmit: true })
        syncMobilePagerMode()
    }

    const handleAssistantShellState = (event) => {
        if (!isAppShell()) return
        const detail = event.detail || {}
        if (detail.presentationMode === 'embedded') return
        if (detail.panelOpen) {
            if (getCurrentViewId() !== 'ia') {
                navigateToView('ia', {
                    source: 'assistant-shell-open',
                    historyMode: 'push',
                    forceEmit: true
                })
            }
            return
        }
        if (getCurrentViewId() === 'ia') {
            navigateToView(lastNonIaViewId || 'muro', {
                source: 'assistant-shell-close',
                historyMode: 'replace',
                forceEmit: true
            })
        }
    }

    const handleAssistantShellReady = () => {
        if (getCurrentViewId() === 'ia') {
            syncAssistantShellForView('ia')
        }
        syncMobilePagerMode()
    }

    const handleAssistantShellSwipe = (event) => {
        if (!isPagerMode() || getCurrentViewId() !== 'ia') return
        const direction = event.detail?.direction === 'prev' ? 'prev' : 'next'
        const targetViewId = direction === 'prev'
            ? getPrevViewId('ia')
            : getNextViewId('ia')
        navigateToView(targetViewId, {
            source: 'assistant-shell-swipe',
            historyMode: 'push',
            direction: direction === 'prev' ? -1 : 1
        })
    }

    const handleBottomNavClick = (event) => {
        const routeEl = event.target.closest('[data-route]')
        if (!routeEl || !bottomNav?.contains(routeEl)) return
        event.preventDefault()
        navigateToView(routeEl.dataset.route, {
            source: 'bottom-nav',
            historyMode: 'push'
        })
    }

    syncStandaloneRootState()
    syncStandaloneViewportVar()
    scheduleSyncAppShellVars()
    window.addEventListener('resize', scheduleSyncAppShellVars, { passive: true })
    window.addEventListener('orientationchange', scheduleSyncAppShellVars, { passive: true })
    window.addEventListener('resize', syncMuroHeaderPlacement, { passive: true })
    window.addEventListener('orientationchange', syncMuroHeaderPlacement, { passive: true })
    window.addEventListener('resize', syncForoLayoutVars, { passive: true })
    window.addEventListener('orientationchange', syncForoLayoutVars, { passive: true })
    window.visualViewport?.addEventListener('resize', scheduleSyncAppShellVars, { passive: true })
    window.visualViewport?.addEventListener('resize', syncForoLayoutVars, { passive: true })

    if (appShellQuery.addEventListener) {
        appShellQuery.addEventListener('change', handleShellChange)
    } else {
        appShellQuery.addListener(handleShellChange)
    }
    if (swipeQuery.addEventListener) {
        swipeQuery.addEventListener('change', syncMobilePagerMode)
    } else {
        swipeQuery.addListener(syncMobilePagerMode)
    }
    if (coarsePointerQuery.addEventListener) {
        coarsePointerQuery.addEventListener('change', syncMobilePagerMode)
    } else {
        coarsePointerQuery.addListener(syncMobilePagerMode)
    }
    if (displayModeQuery.addEventListener) {
        displayModeQuery.addEventListener('change', handleShellChange)
    } else {
        displayModeQuery.addListener(handleShellChange)
    }

    bottomNav?.addEventListener('click', handleBottomNavClick)
    window.addEventListener('hashchange', () => {
        syncViewFromLocation({ source: 'hashchange', allowCanonicalReplace: true, forceEmit: true })
    })
    window.addEventListener('popstate', () => {
        syncViewFromLocation({ source: 'popstate', allowCanonicalReplace: false, forceEmit: true })
    })
    window.addEventListener('dm:assistant-shell-state', handleAssistantShellState)
    window.addEventListener('dm:assistant-shell-ready', handleAssistantShellReady)
    window.addEventListener('dm:assistant-shell-swipe', handleAssistantShellSwipe)
    window.addEventListener('dm:mobile-scroll-release', () => {
        releaseStaleChatMobileState(document.getElementById('brisa-chat-root'))
        refreshScrollState('chat-release')
    })

    window.__dmMobileShell = {
        navigateToView,
        getCurrentViewId,
        getNextViewId,
        getPrevViewId,
        debugScrollState,
        getVerticalScrollDiagnostics,
        refreshScrollState,
        getPagerState
    }

    function clearPagerSettleTimer() {
        // Transform pager has no scroll settle timers.
    }

    function clearPagerRaf() {
        // Transform pager has no scroll sampling RAF.
    }

    function resetPagerSyncFlags() {
        pagerState.isProgrammaticPagerScroll = false
        pagerState.programmaticTargetViewId = null
        pagerState.programmaticStartedAt = 0
        pagerState.programmaticSource = ''
        pagerState.touchTargetIndex = null
    }

    function clearExpiredPagerTouchClamp() {
        // Kept for diagnostics compatibility; transform pager does not clamp native momentum.
    }

    function getPagerState() {
        return {
            enabled: pagerState.enabled,
            activeView: getCurrentViewId(),
            isProgrammaticPagerScroll: pagerState.isProgrammaticPagerScroll,
            programmaticTargetViewId: pagerState.programmaticTargetViewId,
            programmaticSource: pagerState.programmaticSource,
            pageIndex: pagerState.pageIndex,
            dragX: pagerState.dragX,
            activeUserGesture: pagerState.touchActive,
            gestureIntent: pagerState.touchIntent,
            gestureSource: pagerState.gestureSource,
            lastGestureAxis: pagerState.lastGestureAxis,
            lastGestureSource: pagerState.lastGestureSource,
            lastGestureEndReason: pagerState.lastGestureEndReason,
            lastIgnoredTarget: pagerState.lastIgnoredTarget,
            lastDx: pagerState.lastDx,
            lastDy: pagerState.lastDy,
            verticalGestureActive: pagerState.touchActive && pagerState.touchIntent === 'vertical',
            horizontalGestureActive: pagerState.touchActive && pagerState.touchIntent === 'horizontal',
            touchStartIndex: pagerState.touchStartIndex,
            touchTargetIndex: pagerState.touchTargetIndex,
            gestureAssistedScroll: false,
            lastSettledIndex: pagerState.lastSettledIndex,
            pendingSettleTimer: false,
            settleRafId: false,
            track: pagerState.trackEl
                ? {
                    scrollLeft: Math.round(pagerState.trackEl.scrollLeft || 0),
                    clientWidth: pagerState.trackEl.clientWidth || 0,
                    scrollWidth: pagerState.trackEl.scrollWidth || 0,
                    transform: pagerState.trackInnerEl
                        ? window.getComputedStyle(pagerState.trackInnerEl).transform
                        : ''
                }
                : null
        }
    }

    function getVerticalScrollDiagnostics() {
        const activeView = getCurrentViewId()
        const activeScroller = getViewScrollContainer(activeView)
        const chatRoot = document.getElementById('brisa-chat-root')
        const overlay = document.getElementById('brisa-chat-mobile-overlay')
        const bodyStyle = window.getComputedStyle(document.body)
        const htmlStyle = window.getComputedStyle(document.documentElement)
        const scrollerStyle = activeScroller ? window.getComputedStyle(activeScroller) : null
        const trackStyle = pagerState.trackEl ? window.getComputedStyle(pagerState.trackEl) : null
        const overlayStyle = overlay ? window.getComputedStyle(overlay) : null
        return {
            activeView,
            visibleScrollerSelector: getElementDebugLabel(activeScroller),
            visibleScrollerScrollTop: activeScroller?.scrollTop || 0,
            visibleScrollerScrollHeight: activeScroller?.scrollHeight || 0,
            visibleScrollerClientHeight: activeScroller?.clientHeight || 0,
            visibleScrollerOverflowX: scrollerStyle?.overflowX || '',
            visibleScrollerOverflowY: scrollerStyle?.overflowY || '',
            visibleScrollerTouchAction: scrollerStyle?.touchAction || '',
            visibleScrollerOverscrollY: scrollerStyle?.overscrollBehaviorY || '',
            visibleScrollerWebkitOverflowScrolling:
                activeScroller ? scrollerStyle?.webkitOverflowScrolling || '' : '',
            pagerScrollLeft: Math.round(pagerState.trackEl?.scrollLeft || 0),
            pagerClientWidth: pagerState.trackEl?.clientWidth || 0,
            pagerScrollWidth: pagerState.trackEl?.scrollWidth || 0,
            pagerTouchAction: trackStyle?.touchAction || '',
            pagerOverscrollX: trackStyle?.overscrollBehaviorX || '',
            pagerSnapType: trackStyle?.scrollSnapType || '',
            bodyClass: document.body.className,
            bodyOverflow: document.body.style.overflow || bodyStyle.overflow || '',
            bodyTouchAction: document.body.style.touchAction || bodyStyle.touchAction || '',
            htmlOverflow: document.documentElement.style.overflow || htmlStyle.overflow || '',
            htmlTouchAction: document.documentElement.style.touchAction || htmlStyle.touchAction || '',
            pagerState: getPagerState(),
            chatRootClasses: chatRoot?.className || '',
            chatRootPointerEvents: chatRoot?.style.pointerEvents || '',
            overlayHidden: overlay ? overlay.classList.contains('hidden') : true,
            overlayPointerEvents: overlay?.style.pointerEvents || overlayStyle?.pointerEvents || ''
        }
    }

    function debugScrollState() {
        return getVerticalScrollDiagnostics()
    }

    function refreshScrollState(source = 'manual') {
        scheduleSyncAppShellVars()
        syncMuroHeaderPlacement()
        requestAnimationFrame(syncForoLayoutVars)
        if (String(source) === 'chat-release') {
            resetPagerSyncFlags()
            return debugScrollState()
        }
        return debugScrollState()
    }

    function createPagerPage(viewId) {
        const normalizedViewId = normalizeViewId(viewId)
        const page = document.createElement('section')
        page.className = 'dm-mobile-page'
        page.dataset.pageKey = normalizedViewId
        page.dataset.view = normalizedViewId

        const scroller = document.createElement('div')
        scroller.className = 'dm-mobile-page__scroller'
        scroller.dataset.view = normalizedViewId
        if (normalizedViewId === 'muro') {
            scroller.classList.add('dm-mobile-page__scroller--muro')
        }
        if (normalizedViewId === 'foro') {
            scroller.classList.add('dm-mobile-page__scroller--foro')
        }
        if (normalizedViewId === 'ia') {
            scroller.classList.add('dm-mobile-page__scroller--ia')
            const host = document.createElement('div')
            host.className = 'dm-mobile-page__ai-host'
            host.dataset.dmAiEmbeddedHost = 'true'
            scroller.appendChild(host)
            pagerState.assistantHostEl = host
        }

        page.appendChild(scroller)
        pagerState.pagesByKey.set(normalizedViewId, page)
        pagerState.realPagesByView.set(normalizedViewId, page)
        pagerState.scrollersByView.set(normalizedViewId, scroller)
        return page
    }

    function ensurePagerShell() {
        if (!mainEl) return null
        if (pagerState.shellEl?.isConnected && pagerState.trackEl?.isConnected) return pagerState.shellEl

        const shell = document.createElement('div')
        shell.className = 'dm-mobile-pager-shell'

        const viewport = document.createElement('div')
        viewport.className = 'dm-mobile-pager-viewport'

        const track = document.createElement('div')
        track.className = 'dm-mobile-pager-track'
        track.dataset.dmPagerTrack = 'true'

        const trackInner = document.createElement('div')
        trackInner.className = 'dm-mobile-pager-track-inner'
        trackInner.dataset.dmPagerTrackInner = 'true'

        PAGER_ORDER.forEach((viewId) => {
            trackInner.appendChild(createPagerPage(viewId))
        })

        track.appendChild(trackInner)
        viewport.appendChild(track)
        shell.appendChild(viewport)
        mainEl.appendChild(shell)

        pagerState.shellEl = shell
        pagerState.viewportEl = viewport
        pagerState.trackEl = track
        pagerState.trackInnerEl = trackInner
        applyPagerTransform()
        return shell
    }

    function moveViewNodesIntoPager(viewId) {
        const scroller = pagerState.scrollersByView.get(viewId)
        if (!scroller) return
        const nodes = getViewNodes(viewId)
        nodes.forEach((node) => {
            if (!node?.parentNode || scroller.contains(node)) return
            const anchor = document.createComment(`dm-mobile-pager-anchor:${node.id || viewId}`)
            node.parentNode.insertBefore(anchor, node)
            pagerState.anchors.push({ node, anchor })
            scroller.appendChild(node)
        })
    }

    function restoreMovedViewNodes() {
        pagerState.anchors.forEach(({ node, anchor }) => {
            if (!anchor?.parentNode) return
            anchor.parentNode.insertBefore(node, anchor.nextSibling)
            anchor.remove()
        })
        pagerState.anchors = []
    }

    function stashLegacyNodes() {
        pagerState.stashedNodes = []
        Array.from(mainEl?.children || []).forEach((child) => {
            if (child === pagerState.shellEl) return
            child.classList.add('dm-mobile-pager-stashed')
            pagerState.stashedNodes.push(child)
        })
        document.querySelectorAll('.visitas-pill').forEach((node) => {
            node.classList.add('dm-mobile-pager-stashed')
            pagerState.stashedNodes.push(node)
        })
    }

    function restoreStashedNodes() {
        pagerState.stashedNodes.forEach((node) => node?.classList.remove('dm-mobile-pager-stashed'))
        pagerState.stashedNodes = []
    }

    function syncAssistantPresentationMode() {
        const assistantShell = getAssistantShellApi()
        if (!assistantShell?.setPresentationMode) return
        if (isPagerMode() && pagerState.assistantHostEl) {
            assistantShell.setPresentationMode('embedded', { hostEl: pagerState.assistantHostEl })
            return
        }
        assistantShell.setPresentationMode('overlay')
    }

    function clampPagerIndex(index) {
        const numeric = Number.isFinite(index) ? index : 0
        return Math.min(Math.max(Math.round(numeric), 0), PAGER_ORDER.length - 1)
    }

    function getNearestPagerIndex() {
        return clampPagerIndex(pagerState.pageIndex)
    }

    function syncRouteFromPager(viewId, { historyMode = 'push', source = 'pager' } = {}) {
        const normalized = normalizeViewId(viewId)
        if (normalized !== getCurrentViewId() || historyMode !== 'none') {
            navigateToView(normalized, {
                source,
                historyMode,
                forceEmit: normalized !== getCurrentViewId()
            })
        }
    }

    function applyPagerTransform({ dragging = false } = {}) {
        const inner = pagerState.trackInnerEl
        if (!inner) return
        const index = clampPagerIndex(pagerState.pageIndex)
        const dragX = Number.isFinite(pagerState.dragX) ? pagerState.dragX : 0
        inner.style.setProperty('--dm-mobile-page-index', String(index))
        inner.style.setProperty('--dm-mobile-page-x', `${index * -100}%`)
        inner.style.setProperty('--dm-mobile-drag-x', `${Math.round(dragX)}px`)
        inner.classList.toggle('is-dragging', Boolean(dragging))
    }

    function setPagerIndex(index, { source = 'pager', syncRoute = false, historyMode = 'push', dragging = false } = {}) {
        const nextIndex = clampPagerIndex(index)
        pagerState.pageIndex = nextIndex
        pagerState.lastSettledIndex = nextIndex
        pagerState.dragX = 0
        pagerState.touchTargetIndex = nextIndex
        pagerState.isProgrammaticPagerScroll = false
        pagerState.programmaticTargetViewId = getViewIdFromPagerIndex(nextIndex)
        pagerState.programmaticStartedAt = performance.now()
        pagerState.programmaticSource = source
        applyPagerTransform({ dragging })
        if (syncRoute) {
            syncRouteFromPager(getViewIdFromPagerIndex(nextIndex), { historyMode, source: 'pager' })
        }
        resetPagerSyncFlags()
    }

    function scrollPagerToView(viewId, { source = 'route' } = {}) {
        if (!isPagerMode() || !pagerState.trackEl) return
        const realIndex = getPagerRealIndex(viewId)
        if (realIndex < 0) return

        setPagerIndex(realIndex, { source, syncRoute: false })
    }

    function resetPagerTouchState({ preserveTarget = false, keepAxis = false } = {}) {
        const pointerId = pagerState.pointerId
        pagerState.touchActive = false
        pagerState.touchIntent = 'idle'
        pagerState.gestureSource = 'idle'
        pagerState.pointerId = null
        pagerState.pendingPointerTouch = null
        pagerState.touchStartX = 0
        pagerState.touchStartY = 0
        pagerState.touchStartIndex = -1
        if (!preserveTarget) pagerState.touchTargetIndex = null
        pagerState.touchLastX = 0
        pagerState.touchLastY = 0
        pagerState.dragX = 0
        if (!keepAxis) pagerState.lastGestureAxis = 'idle'
        if (pointerId !== null) {
            try {
                pagerState.trackEl?.releasePointerCapture?.(pointerId)
            } catch (e) {}
        }
        applyPagerTransform()
    }

    function getPagerPointerPoint(event) {
        if (!event) return null
        return {
            x: event.clientX,
            y: event.clientY
        }
    }

    function getPagerTouchPoint(event, { changed = false } = {}) {
        const list = changed ? event?.changedTouches : event?.touches
        const touch = list?.[0]
        if (!touch) return null
        return {
            x: touch.clientX,
            y: touch.clientY
        }
    }

    function getPagerWheelDelta(event) {
        if (!event) return { x: 0, y: 0 }
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? getPagerPageWidth() || window.innerWidth || 1
                : 1
        const rawX = Number.isFinite(event.deltaX) ? event.deltaX : 0
        const rawY = Number.isFinite(event.deltaY) ? event.deltaY : 0
        return {
            x: (rawX || (event.shiftKey ? rawY : 0)) * unit,
            y: (rawX ? rawY : event.shiftKey ? 0 : rawY) * unit
        }
    }

    function updatePagerGestureDiagnostics(dx = 0, dy = 0) {
        pagerState.lastDx = Math.round(Number.isFinite(dx) ? dx : 0)
        pagerState.lastDy = Math.round(Number.isFinite(dy) ? dy : 0)
        pagerState.lastGestureSource = pagerState.gestureSource || 'idle'
    }

    function isChatMobileSurfaceActive(chatRoot) {
        if (!chatRoot) return false
        const overlay = chatRoot.querySelector('#brisa-chat-mobile-overlay')
        const viewport = chatRoot.querySelector('#brisa-chat-mobile-viewport')
        const activeSurface = chatRoot.querySelector(
            '[data-chat-state="open"], [data-chat-state="opening"]'
        )
        const overlayActive = Boolean(
            overlay &&
            !overlay.classList.contains('hidden') &&
            overlay.getAttribute('aria-hidden') !== 'true'
        )
        const viewportActive = Boolean(
            viewport &&
            viewport.getAttribute('aria-hidden') !== 'true' &&
            viewport.inert !== true
        )
        return Boolean(activeSurface || overlayActive || viewportActive)
    }

    function releaseStaleChatMobileState(chatRoot) {
        if (!chatRoot?.classList?.contains('brisa-chat-root--mobile-open')) return false
        if (isChatMobileSurfaceActive(chatRoot)) return true
        const overlay = chatRoot.querySelector('#brisa-chat-mobile-overlay')
        const viewport = chatRoot.querySelector('#brisa-chat-mobile-viewport')
        chatRoot.classList.remove('brisa-chat-root--mobile-open', 'brisa-chat-root--mobile-detail')
        chatRoot.style.pointerEvents = ''
        document.documentElement.style.overflow = ''
        document.documentElement.style.touchAction = ''
        document.body.style.overflow = ''
        document.body.style.touchAction = ''
        overlay?.classList.add('hidden')
        overlay?.setAttribute('aria-hidden', 'true')
        viewport?.setAttribute('aria-hidden', 'true')
        if (viewport && 'inert' in viewport) viewport.inert = true
        return false
    }

    function isPagerSwipeIgnoredTarget(target) {
        const chatRoot = document.getElementById('brisa-chat-root')
        if (releaseStaleChatMobileState(chatRoot)) {
            pagerState.lastIgnoredTarget = getElementDebugLabel(chatRoot) || '#brisa-chat-root'
            return true
        }
        const el = target?.closest?.(
            'input, textarea, select, [contenteditable="true"], [data-no-pager-swipe], .dm-muro-composer, .dm-bottom-nav, .brisa-chat-bubble, .brisa-chat-panel[data-chat-state="open"], .brisa-chat-panel[data-chat-state="opening"], .brisa-chat-window[data-chat-state="open"], .brisa-chat-window[data-chat-state="opening"], .brisa-chat-mobile-overlay:not(.hidden), .brisa-chat-mobile-viewport:not([aria-hidden="true"])'
        )
        if (el) pagerState.lastIgnoredTarget = getElementDebugLabel(el) || ''
        return Boolean(el)
    }

    function isPagerWheelIgnoredTarget(target) {
        const chatRoot = document.getElementById('brisa-chat-root')
        if (releaseStaleChatMobileState(chatRoot)) {
            pagerState.lastIgnoredTarget = getElementDebugLabel(chatRoot) || '#brisa-chat-root'
            return true
        }
        const el = target?.closest?.(
            'input, textarea, select, [contenteditable="true"], [data-no-pager-swipe], .dm-bottom-nav, .brisa-chat-bubble, .brisa-chat-panel[data-chat-state="open"], .brisa-chat-panel[data-chat-state="opening"], .brisa-chat-window[data-chat-state="open"], .brisa-chat-window[data-chat-state="opening"], .brisa-chat-mobile-overlay:not(.hidden), .brisa-chat-mobile-viewport:not([aria-hidden="true"])'
        )
        if (el) pagerState.lastIgnoredTarget = getElementDebugLabel(el) || ''
        return Boolean(el)
    }

    function startPagerGesture({ point, target, source = 'pointer', pointerId = null } = {}) {
        if (!isPagerMode() || !pagerState.trackEl) return
        if (pagerState.touchActive) return
        if (!point) return
        pagerState.lastGestureSource = source
        pagerState.lastGestureEndReason = 'start'
        pagerState.lastIgnoredTarget = ''
        pagerState.lastDx = 0
        pagerState.lastDy = 0
        if (isPagerSwipeIgnoredTarget(target)) {
            pagerState.lastGestureEndReason = 'ignored-target'
            resetPagerTouchState()
            return
        }
        const trackRect = pagerState.trackEl.getBoundingClientRect()
        const startsInsideTrack =
            point.x >= trackRect.left &&
            point.x <= trackRect.right &&
            point.y >= trackRect.top &&
                point.y <= trackRect.bottom
        if (!startsInsideTrack) {
            pagerState.lastIgnoredTarget = getElementDebugLabel(target) || ''
            pagerState.lastGestureEndReason = 'outside-track'
            resetPagerTouchState()
            return
        }
        pagerState.touchActive = true
        pagerState.touchIntent = 'pending'
        pagerState.gestureSource = source
        pagerState.pointerId = pointerId
        pagerState.touchStartX = point.x
        pagerState.touchStartY = point.y
        pagerState.touchStartIndex = clampPagerIndex(pagerState.pageIndex)
        pagerState.touchTargetIndex = null
        pagerState.touchLastX = point.x
        pagerState.touchLastY = point.y
        pagerState.lastGestureAxis = 'pending'
        pagerState.dragX = 0
        if ((source === 'pointer' || source === 'pointer-touch') && pointerId !== null) {
            try {
                pagerState.trackEl.setPointerCapture?.(pointerId)
            } catch (e) {}
        }
        applyPagerTransform()
    }

    function updatePagerGesture(point, event, { pointerId = null } = {}) {
        if (!pagerState.touchActive || !isPagerMode() || !pagerState.trackEl) return
        if (pagerState.pointerId !== null && pointerId !== null && pointerId !== pagerState.pointerId) return
        if (!point) return
        const dx = point.x - pagerState.touchStartX
        const dy = point.y - pagerState.touchStartY
        const absX = Math.abs(dx)
        const absY = Math.abs(dy)
        pagerState.touchLastX = point.x
        pagerState.touchLastY = point.y
        updatePagerGestureDiagnostics(dx, dy)

        if (pagerState.touchIntent === 'pending') {
            const horizontalIntent =
                absX >= PAGER_TOUCH_HORIZONTAL_PX &&
                absX > absY * PAGER_TOUCH_HORIZONTAL_RATIO
            const verticalIntent =
                absY >= PAGER_TOUCH_VERTICAL_PX &&
                absY > absX * PAGER_TOUCH_VERTICAL_RATIO
            if (horizontalIntent) {
                pagerState.touchIntent = 'horizontal'
                pagerState.lastGestureAxis = 'horizontal'
                pagerState.lastGestureEndReason = 'horizontal-intent'
                resetPagerSyncFlags()
                if (pointerId !== null) {
                    try {
                        pagerState.trackEl.setPointerCapture?.(pointerId)
                    } catch (e) {}
                }
            } else if (verticalIntent) {
                pagerState.touchIntent = 'vertical'
                pagerState.lastGestureAxis = 'vertical'
                pagerState.lastGestureEndReason = 'vertical-intent'
                if (pagerState.pointerId !== null) {
                    try {
                        pagerState.trackEl.releasePointerCapture?.(pagerState.pointerId)
                    } catch (e) {}
                }
                return
            } else {
                return
            }
        }

        if (pagerState.touchIntent !== 'horizontal') return
        const width = getPagerPageWidth()
        if (width) {
            const minIndex = clampPagerIndex(pagerState.touchStartIndex - 1)
            const maxIndex = clampPagerIndex(pagerState.touchStartIndex + 1)
            const minDrag = (pagerState.touchStartIndex - maxIndex) * width
            const maxDrag = (pagerState.touchStartIndex - minIndex) * width
            pagerState.dragX = Math.min(Math.max(dx, minDrag), maxDrag)
            applyPagerTransform({ dragging: true })
        }
        if (pagerState.gestureSource !== 'mouse' && event.cancelable) event.preventDefault()
    }

    function finishPagerGesture(event, { pointerId = null, cancelled = false } = {}) {
        if (!pagerState.touchActive) return
        if (pagerState.pointerId !== null && pointerId !== null && pointerId !== pagerState.pointerId) return
        const dx = pagerState.touchLastX - pagerState.touchStartX
        const dy = pagerState.touchLastY - pagerState.touchStartY
        updatePagerGestureDiagnostics(dx, dy)
        if (cancelled) {
            pagerState.lastGestureEndReason = 'cancelled'
            resetPagerTouchState({ keepAxis: true })
            return
        }
        const wasHorizontal = pagerState.touchIntent === 'horizontal'
        const width = getPagerPageWidth()
        const startIndex = pagerState.touchStartIndex >= 0
            ? pagerState.touchStartIndex
            : getNearestPagerIndex()

        if (!wasHorizontal || !isPagerMode() || !pagerState.trackEl || !width) {
            pagerState.lastGestureEndReason = pagerState.touchIntent || 'not-horizontal'
            resetPagerTouchState({ keepAxis: true })
            return
        }

        const commitPx = pagerState.gestureSource === 'mouse'
            ? PAGER_MOUSE_COMMIT_PX
            : PAGER_TOUCH_COMMIT_PX
        const movedEnough =
            Math.abs(dx) >= commitPx ||
            Math.abs(dx) >= width * PAGER_TOUCH_SWIPE_RATIO
        const direction = dx < 0 ? 1 : -1
        const targetIndex = clampPagerIndex(movedEnough ? startIndex + direction : startIndex)
        const didChangePage = targetIndex !== startIndex
        pagerState.lastGestureEndReason = didChangePage ? 'committed' : 'below-threshold'
        if (didChangePage) {
            pagerState.suppressNextClick = true
            window.setTimeout(() => {
                pagerState.suppressNextClick = false
            }, 450)
        }
        resetPagerTouchState({ preserveTarget: true, keepAxis: true })
        setPagerIndex(targetIndex, {
            source: 'touch',
            syncRoute: didChangePage,
            historyMode: 'push'
        })
    }

    function handlePagerPointerDown(event) {
        if (event.pointerType === 'touch' && hasTouchInput()) {
            if (event.isPrimary === false) return
            pagerState.pendingPointerTouch = {
                point: getPagerPointerPoint(event),
                target: event.target,
                pointerId: event.pointerId
            }
            return
        }
        if (event.pointerType === 'mouse') return
        if (event.isPrimary === false) return
        startPagerGesture({
            point: getPagerPointerPoint(event),
            target: event.target,
            source: 'pointer',
            pointerId: event.pointerId
        })
    }

    function handlePagerPointerMove(event) {
        if (event.pointerType === 'touch' && hasTouchInput()) {
            if (pagerState.gestureSource === 'touch') return
            if (!pagerState.touchActive && pagerState.pendingPointerTouch?.pointerId === event.pointerId) {
                startPagerGesture({
                    ...pagerState.pendingPointerTouch,
                    source: 'pointer-touch'
                })
            }
            if (pagerState.gestureSource !== 'pointer-touch') return
            updatePagerGesture(getPagerPointerPoint(event), event, { pointerId: event.pointerId })
            return
        }
        if (event.pointerType === 'mouse') return
        if (pagerState.gestureSource !== 'pointer') return
        updatePagerGesture(getPagerPointerPoint(event), event, { pointerId: event.pointerId })
    }

    function handlePagerPointerEnd(event) {
        if (event?.pointerType === 'touch' && hasTouchInput()) {
            if (pagerState.pendingPointerTouch?.pointerId === event?.pointerId) {
                pagerState.pendingPointerTouch = null
            }
            if (pagerState.gestureSource !== 'pointer-touch') return
        } else if (event?.pointerType === 'mouse') {
            if (pagerState.gestureSource === 'mouse') finishPagerGesture(event)
            return
        } else if (pagerState.gestureSource !== 'pointer') {
            return
        }
        if (event?.type === 'lostpointercapture') return
        const shouldCancel = event?.type === 'pointercancel' && pagerState.touchIntent !== 'horizontal'
        finishPagerGesture(event, {
            pointerId: event?.pointerId,
            cancelled: shouldCancel
        })
    }

    function handlePagerClickCapture(event) {
        if (!pagerState.suppressNextClick) return
        pagerState.suppressNextClick = false
        event.preventDefault()
        event.stopPropagation()
    }

    function handlePagerTouchStart(event) {
        if (event.touches?.length !== 1) return
        pagerState.pendingPointerTouch = null
        startPagerGesture({
            point: getPagerTouchPoint(event),
            target: event.target,
            source: 'touch'
        })
    }

    function handlePagerTouchMove(event) {
        if (pagerState.gestureSource !== 'touch') return
        if (event.touches?.length !== 1) {
            pagerState.lastGestureEndReason = 'multi-touch'
            resetPagerTouchState({ keepAxis: true })
            return
        }
        updatePagerGesture(getPagerTouchPoint(event), event)
    }

    function handlePagerTouchEnd(event) {
        if (pagerState.gestureSource !== 'touch') return
        const point = getPagerTouchPoint(event, { changed: true })
        if (point) {
            pagerState.touchLastX = point.x
            pagerState.touchLastY = point.y
        }
        const shouldCancel = event?.type === 'touchcancel' && pagerState.touchIntent !== 'horizontal'
        finishPagerGesture(event, { cancelled: shouldCancel })
    }

    function handlePagerMouseDown(event) {
        if (event.button !== 0) return
        if (pagerState.touchActive) return
        startPagerGesture({
            point: getPagerPointerPoint(event),
            target: event.target,
            source: 'mouse'
        })
    }

    function handlePagerMouseMove(event) {
        if (pagerState.gestureSource !== 'mouse') return
        updatePagerGesture(getPagerPointerPoint(event), event)
    }

    function handlePagerMouseEnd(event) {
        if (pagerState.gestureSource !== 'mouse') return
        finishPagerGesture(event)
    }

    function handlePagerWheel(event) {
        if (!isPagerMode() || !pagerState.trackEl || pagerState.touchActive) return
        const point = getPagerPointerPoint(event)
        if (!point) return
        const trackRect = pagerState.trackEl.getBoundingClientRect()
        const isInsideTrack =
            point.x >= trackRect.left &&
            point.x <= trackRect.right &&
            point.y >= trackRect.top &&
            point.y <= trackRect.bottom
        if (!isInsideTrack || isPagerWheelIgnoredTarget(event.target)) return

        const { x, y } = getPagerWheelDelta(event)
        const absX = Math.abs(x)
        const absY = Math.abs(y)
        const horizontalWheel = absX > 0 && absX > absY * PAGER_WHEEL_HORIZONTAL_RATIO
        if (!horizontalWheel) return

        const now = performance.now()
        if (now < pagerState.wheelLockUntil) {
            if (event.cancelable) event.preventDefault()
            pagerState.lastGestureAxis = 'horizontal'
            pagerState.lastGestureEndReason = 'wheel-locked'
            updatePagerGestureDiagnostics(x, y)
            pagerState.lastGestureSource = 'wheel'
            return
        }

        if (now - pagerState.wheelLastAt > PAGER_WHEEL_GESTURE_GAP_MS) {
            pagerState.wheelAccumX = 0
            pagerState.wheelAccumY = 0
        }
        pagerState.wheelLastAt = now
        pagerState.wheelAccumX += x
        pagerState.wheelAccumY += y
        const totalX = pagerState.wheelAccumX
        const totalY = pagerState.wheelAccumY
        const totalAbsX = Math.abs(totalX)
        const totalAbsY = Math.abs(totalY)

        pagerState.lastGestureAxis = 'horizontal'
        pagerState.lastGestureEndReason = 'wheel-collecting'
        updatePagerGestureDiagnostics(totalX, totalY)
        pagerState.lastGestureSource = 'wheel'

        if (
            totalAbsX < PAGER_WHEEL_HORIZONTAL_PX ||
            totalAbsX <= totalAbsY * PAGER_WHEEL_HORIZONTAL_RATIO
        ) {
            return
        }

        if (event.cancelable) event.preventDefault()
        const startIndex = clampPagerIndex(pagerState.pageIndex)
        const direction = totalX > 0 ? 1 : -1
        const targetIndex = clampPagerIndex(startIndex + direction)
        const didChangePage = targetIndex !== startIndex
        pagerState.wheelAccumX = 0
        pagerState.wheelAccumY = 0
        pagerState.wheelLockUntil = now + PAGER_WHEEL_LOCK_MS
        pagerState.lastGestureEndReason = didChangePage ? 'wheel-committed' : 'wheel-boundary'
        if (didChangePage) {
            setPagerIndex(targetIndex, {
                source: 'wheel',
                syncRoute: true,
                historyMode: 'push'
            })
        }
    }

    function syncPagerFromRoute({ source = 'pager-sync' } = {}) {
        if (!isPagerMode()) return
        scrollPagerToView(getCurrentViewId(), { source })
    }

    function cleanupPagerListeners() {
        pagerState.pagerController?.abort?.()
        pagerState.pagerController = null
        resetPagerSyncFlags()
        resetPagerTouchState()
    }

    function bindPagerListeners() {
        if (!pagerState.trackEl) return
        cleanupPagerListeners()
        const controller = new AbortController()
        pagerState.pagerController = controller
        if (hasTouchInput()) {
            document.addEventListener('touchstart', handlePagerTouchStart, {
                passive: true,
                capture: true,
                signal: controller.signal
            })
            document.addEventListener('touchmove', handlePagerTouchMove, {
                passive: false,
                capture: true,
                signal: controller.signal
            })
            ;['touchend', 'touchcancel'].forEach((eventName) => {
                document.addEventListener(eventName, handlePagerTouchEnd, {
                    passive: true,
                    capture: true,
                    signal: controller.signal
                })
            })
        }
        if (window.PointerEvent) {
            document.addEventListener('pointerdown', handlePagerPointerDown, {
                passive: true,
                capture: true,
                signal: controller.signal
            })
            document.addEventListener('pointermove', handlePagerPointerMove, {
                passive: false,
                capture: true,
                signal: controller.signal
            })
            ;['pointerup', 'pointercancel'].forEach((eventName) => {
                document.addEventListener(eventName, handlePagerPointerEnd, {
                    passive: true,
                    capture: true,
                    signal: controller.signal
                })
            })
        }
        document.addEventListener('mousedown', handlePagerMouseDown, {
            passive: true,
            capture: true,
            signal: controller.signal
        })
        document.addEventListener('mousemove', handlePagerMouseMove, {
            passive: false,
            capture: true,
            signal: controller.signal
        })
        document.addEventListener('mouseup', handlePagerMouseEnd, {
            passive: true,
            capture: true,
            signal: controller.signal
        })
        document.addEventListener('wheel', handlePagerWheel, {
            passive: false,
            capture: true,
            signal: controller.signal
        })
        document.addEventListener('click', handlePagerClickCapture, {
            passive: false,
            capture: true,
            signal: controller.signal
        })
    }

    function enterMobilePagerMode() {
        if (isPagerMode() || !mainEl) return

        ensurePagerShell()
        ;['muro', 'estructura', 'comites', 'foro'].forEach((viewId) => {
            moveViewNodesIntoPager(viewId)
        })
        stashLegacyNodes()
        document.body.classList.add('dm-mobile-pager-mode')
        pagerState.enabled = true
        bindPagerListeners()
        syncAssistantPresentationMode()
        syncAssistantShellForView(getCurrentViewId())
        syncMuroHeaderPlacement()
        bindShellScrollListener()
        bindMuroScrollListener()
        syncPagerFromRoute({ behavior: 'auto', source: 'pager-enter' })
    }

    function exitMobilePagerMode() {
        if (!isPagerMode()) return

        cleanupPagerListeners()
        document.body.classList.remove('dm-mobile-pager-mode')
        pagerState.enabled = false
        syncAssistantPresentationMode()
        restoreMovedViewNodes()
        restoreStashedNodes()
        pagerState.pagesByKey.clear()
        pagerState.realPagesByView.clear()
        pagerState.scrollersByView.clear()
        pagerState.assistantHostEl = null
        pagerState.shellEl?.remove()
        pagerState.shellEl = null
        pagerState.viewportEl = null
        pagerState.trackEl = null
        pagerState.trackInnerEl = null
        pagerState.pageIndex = 0
        pagerState.dragX = 0
        pagerState.lastSettledIndex = -1
        syncMuroHeaderPlacement()
        syncAssistantShellForView(getCurrentViewId())
        bindShellScrollListener()
        bindMuroScrollListener()
    }

    function syncMobilePagerMode() {
        const shouldEnable = isSwipeRuntime() && !!mainEl
        if (!shouldEnable) {
            exitMobilePagerMode()
            return
        }
        if (!isPagerMode()) {
            enterMobilePagerMode()
            return
        }
        syncAssistantPresentationMode()
        syncPagerFromRoute({ behavior: 'auto', source: 'pager-sync' })
    }

    window.addEventListener('resize', () => {
        if (!isPagerMode()) return
        requestAnimationFrame(() => {
            syncPagerFromRoute({ behavior: 'auto', source: 'resize' })
        })
    }, { passive: true })
    window.addEventListener('blur', () => {
        if (!isPagerMode()) return
        clearPagerSettleTimer()
        clearPagerRaf()
        resetPagerSyncFlags()
        resetPagerTouchState()
    })
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden || !isPagerMode()) return
        clearPagerSettleTimer()
        clearPagerRaf()
        resetPagerSyncFlags()
        resetPagerTouchState()
    })
    window.addEventListener('orientationchange', () => {
        if (!isPagerMode()) return
        requestAnimationFrame(() => {
            syncPagerFromRoute({ behavior: 'auto', source: 'orientationchange' })
        })
    }, { passive: true })
    window.visualViewport?.addEventListener('resize', () => {
        if (!isPagerMode()) return
        requestAnimationFrame(() => {
            syncPagerFromRoute({ behavior: 'auto', source: 'visualViewport-resize' })
        })
    }, { passive: true })

    /*==================== REFERENTES: DESKTOP OPEN ====================*/
    const referentesQuery = window.matchMedia('(min-width: 769px)')
    const syncReferentesAccordion = () => {
        const items = document.querySelectorAll('.dm-accordion__item')
        if (!items.length) return
        if (referentesQuery.matches) {
            items.forEach((item) => item.setAttribute('open', ''))
        } else {
            items.forEach((item) => item.removeAttribute('open'))
        }
    }
    if (referentesQuery.addEventListener) {
        referentesQuery.addEventListener('change', syncReferentesAccordion)
    } else {
        referentesQuery.addListener(syncReferentesAccordion)
    }
    syncReferentesAccordion()

    const referentesContainer = document.querySelector('#referentes .dm-accordion')
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

    const mainScroller = mainEl;
    const hoverClass = "disable-hover";
    let hoverTimer = 0;
    let hoverActive = false;
    let scrollUiTicking = false;
    let scrollUpVisible = null;
    let shellScrollEl = null;

    const handleDisableHover = () => {
        if (!document.body) return;
        if (!hoverActive) {
            document.body.classList.add(hoverClass);
            hoverActive = true;
        }
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => {
            document.body.classList.remove(hoverClass);
            hoverActive = false;
        }, 150);
    };

    const getScrollTop = () => {
        if (document.body.dataset.view) {
            const scrollEl = getViewScrollContainer(getCurrentViewId()) || mainScroller
            if (scrollEl === window) return window.scrollY || 0
            return scrollEl?.scrollTop || 0
        }
        return window.scrollY || document.documentElement.scrollTop || 0;
    };

    /*==================== SHOW SCROLL UP ====================*/
    function scrollUp(y = getScrollTop()) {
        const btn = document.getElementById("scroll-up");
        if (!btn) return;
        if (isPagerMode() || document.body?.dataset?.view) {
            scrollUpVisible = false;
            btn.classList.remove("show-scroll");
            return;
        }
        const shouldShow = y >= 200;
        if (scrollUpVisible === shouldShow) return;
        scrollUpVisible = shouldShow;
        btn.classList.toggle("show-scroll", shouldShow);
    }

    const scrollToTop = () => {
        if (document.body.dataset.view) {
            const scrollEl = getViewScrollContainer(getCurrentViewId()) || mainScroller
            if (scrollEl && scrollEl !== window) {
                scrollEl.scrollTo({ top: 0, behavior: "smooth" });
                return;
            }
        }
        if (mainScroller && document.body.dataset.view) {
            mainScroller.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    /*==================== CHANGE BACKGROUND HEADER ====================*/
    let headerIsCompact = null;
    function scrollHeader(y = getScrollTop()) {
        const nav = document.getElementById("header");
        if (!nav) return;
        const shouldCompact = y >= 80;
        if (headerIsCompact !== shouldCompact) {
            headerIsCompact = shouldCompact;
            nav.classList.toggle("scroll-header", shouldCompact);
            // La altura del header cambia con este modo → recalcular offset del scroll container.
            scheduleSyncAppShellVars();
        }
    }

    const scheduleScrollUI = () => {
        handleDisableHover();
        if (scrollUiTicking) return;
        scrollUiTicking = true;
        requestAnimationFrame(() => {
            scrollUiTicking = false;
            const y = getScrollTop();
            scrollUp(y);
            scrollHeader(y);
            debugStandaloneScrollState('scroll-ui');
        });
    };

    function bindShellScrollListener() {
        const nextScrollEl = document.body.dataset.view
            ? (getViewScrollContainer(getCurrentViewId()) || mainScroller || window)
            : window

        if (shellScrollEl === nextScrollEl) return

        if (shellScrollEl === window) {
            window.removeEventListener("scroll", scheduleScrollUI)
        } else if (shellScrollEl) {
            shellScrollEl.removeEventListener("scroll", scheduleScrollUI)
        }

        shellScrollEl = nextScrollEl

        if (shellScrollEl === window) {
            window.addEventListener("scroll", scheduleScrollUI, { passive: true })
        } else if (shellScrollEl) {
            shellScrollEl.addEventListener("scroll", scheduleScrollUI, { passive: true })
        }
    }

    bindShellScrollListener()

    scrollUp();
    scrollHeader();
    const scrollUpBtn = document.getElementById("scroll-up");
    if (scrollUpBtn) {
        scrollUpBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            scrollToTop();
        });
    }

    /*==================== HIDE/SHOW MURO COMPOSER ====================*/
    let lastScrollY = 0;
    let muroHidden = false;
    let muroScrollAccumulator = 0;
    const muroRevealOffset = 120;
    const muroToggleThreshold = 10;
    const muroDeltaMin = 1;

    function getMuroScrollContainer() {
        if (document.body?.dataset?.view) {
            return getViewScrollContainer('muro') || mainScroller || window;
        }
        return window;
    }

    let muroScrollEl = getMuroScrollContainer();

    function getScrollY() {
        if (muroScrollEl === window) return window.scrollY || 0;
        return muroScrollEl?.scrollTop || 0;
    }

    function toggleMuroComposer(hide) {
        if (!muroComposer) return;
        muroHidden = hide;

        document.body.classList.toggle('dm-muro-hidden', hide);
        muroComposer.classList.toggle('is-hidden', hide);
        muroScrollAccumulator = 0;

        if (hide) {
            muroComposer.setAttribute('aria-hidden', 'true');
        } else {
            muroComposer.removeAttribute('aria-hidden');
        }

        muroComposer.style.removeProperty('transform');
        muroComposer.style.removeProperty('opacity');
        muroComposer.style.removeProperty('pointer-events');
    }

    let muroTicking = false;

    function handleMuroComposerScroll() {
        const isCarreteView =
            !document.body?.dataset?.view || document.body?.dataset?.view === 'carrete';
        if (!muroComposer || !isCarreteView) return;

        const currentY = getScrollY();
        const delta = currentY - lastScrollY;

        if (currentY <= muroRevealOffset) {
            if (muroHidden) toggleMuroComposer(false);
            muroScrollAccumulator = 0;
            lastScrollY = currentY;
            return;
        }

        if (Math.abs(delta) < muroDeltaMin) {
            lastScrollY = currentY;
            return;
        }

        if ((delta > 0 && muroScrollAccumulator < 0) || (delta < 0 && muroScrollAccumulator > 0)) {
            muroScrollAccumulator = 0;
        }

        muroScrollAccumulator += delta;

        if (muroScrollAccumulator > muroToggleThreshold && !muroHidden) {
            toggleMuroComposer(true);
        } else if (muroScrollAccumulator < -muroToggleThreshold && muroHidden) {
            toggleMuroComposer(false);
        }

        lastScrollY = currentY;
    }

    function scheduleMuroComposerScroll() {
        if (muroTicking) return;
        muroTicking = true;
        requestAnimationFrame(() => {
            muroTicking = false;
            handleMuroComposerScroll();
        });
    }

    function bindMuroScrollListener() {
        const next = getMuroScrollContainer();
        if (next === muroScrollEl) return;

        // Detach previous
        if (muroScrollEl === window) {
            window.removeEventListener('scroll', scheduleMuroComposerScroll);
        } else if (muroScrollEl) {
            muroScrollEl.removeEventListener('scroll', scheduleMuroComposerScroll);
        }

        muroScrollEl = next;
        lastScrollY = getScrollY();
        muroScrollAccumulator = 0;

        // Attach new
        if (muroScrollEl === window) {
            window.addEventListener('scroll', scheduleMuroComposerScroll, { passive: true });
        } else if (muroScrollEl) {
            muroScrollEl.addEventListener('scroll', scheduleMuroComposerScroll, { passive: true });
        }
    }

    // Initial bind
    bindMuroScrollListener();
    lastScrollY = getScrollY();

    // Re-bind when route changes or layout changes
    window.addEventListener('dm:viewchange', () => {
        bindShellScrollListener();
        bindMuroScrollListener();
        requestAnimationFrame(syncForoLayoutVars);
        requestAnimationFrame(() => { lastScrollY = getScrollY(); });
    });

    window.addEventListener('resize', () => {
        bindShellScrollListener();
        bindMuroScrollListener();
        requestAnimationFrame(syncForoLayoutVars);
        requestAnimationFrame(() => { lastScrollY = getScrollY(); });
    }, { passive: true });

    // Re-bind when feed-mode toggles on the section (module script sets it)
    if (carreteSection && window.MutationObserver) {
        const mo = new MutationObserver(() => {
            bindMuroScrollListener();
            syncMuroHeaderPlacement();
        });
        mo.observe(carreteSection, { attributes: true, attributeFilter: ['class'] });
    }

    syncViewFromLocation({ source: 'init', allowCanonicalReplace: true, forceEmit: true })
    syncMobilePagerMode()
    requestAnimationFrame(syncForoLayoutVars)
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

function renderStructureAvatar({ className, name, uid, fallbackIcon }) {
    const safeName = escapeStructureAttribute(name || 'Usuario');
    const safeUid = escapeStructureAttribute(uid || MEDICAL_USER_UIDS[name] || '');
    const uidAttr = safeUid ? ` data-dm-avatar-uid="${safeUid}"` : '';

    return `
        <div class="${className} structure-avatar"${uidAttr} data-dm-author="${safeName}" data-dm-avatar-name="${safeName}" data-dm-avatar-zoom>
            <img class="structure-avatar__img" data-dm-avatar-img alt="${safeName}" hidden>
            <span class="structure-avatar__fallback" data-dm-avatar-fallback aria-hidden="true">${fallbackIcon}</span>
        </div>
    `;
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
            </div>
            <figcaption class="structure-avatar-lightbox__caption"></figcaption>
        </figure>
    `;
    document.body.appendChild(overlay);

    const image = overlay.querySelector('.structure-avatar-lightbox__img');
    const caption = overlay.querySelector('.structure-avatar-lightbox__caption');
    const closeButton = overlay.querySelector('.structure-avatar-lightbox__close');

    const close = () => {
        overlay.setAttribute('hidden', '');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('dm-modal-open');
        if (image) {
            image.removeAttribute('src');
            image.alt = '';
        }
        if (caption) caption.textContent = '';
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
        caption,
        close
    };

    return structureAvatarLightbox;
}

function getStructureAvatarImage(avatarEl) {
    if (!avatarEl?.dataset || avatarEl.dataset.hasAvatar !== '1') return null;
    const image = avatarEl.querySelector('[data-dm-avatar-img], .structure-avatar__img');
    if (!image || image.hidden) return null;
    const src = image.currentSrc || image.src || '';
    return src ? image : null;
}

function openStructureAvatarLightbox(avatarEl) {
    const sourceImage = getStructureAvatarImage(avatarEl);
    if (!sourceImage) return;

    const modal = ensureStructureAvatarLightbox();
    const displayName =
        avatarEl.dataset.dmAvatarName ||
        avatarEl.dataset.dmAuthor ||
        sourceImage.alt ||
        'Avatar';

    if (modal.image) {
        modal.image.src = sourceImage.currentSrc || sourceImage.src;
        modal.image.alt = displayName;
    }
    if (modal.caption) modal.caption.textContent = displayName;

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
                    fallbackIcon: StructureIcons.UserLarge
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
        regionsContainer.appendChild(createRegionElement(region));
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
        .flatMap(sector => sector.staff || [])
        .filter(person => {
            const key = `${person.name}|${person.role || ''}|${person.isCoordinator ? '1' : '0'}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function createRegionElement(region) {
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
        const coordinationBlock = createRegionCoordinationBlock(region, coordinationSectors);
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
        sectorsList.appendChild(createSectorElement(sector));
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

function createRegionCoordinationBlock(region, coordinationSectors = []) {
    const coordinators = extractRegionalCoordinators(coordinationSectors);
    if (!coordinators.length) return null;

    const block = document.createElement('section');
    block.className = 'region-coordination-block';
    block.innerHTML = `
        <div class="coordination-grid" data-count="${coordinators.length}">
            <!-- Coordinators injected here -->
        </div>
    `;

    const grid = block.querySelector('.coordination-grid');
    coordinators.forEach(person => {
        grid.appendChild(createCoordinationCard(person));
    });

    return block;
}

function createCoordinationCard(person) {
    const card = document.createElement('article');
    card.className = 'coordination-card';
    card.innerHTML = `
        ${renderStructureAvatar({
            className: 'coordination-card__icon',
            name: person.name,
            uid: person.uid,
            fallbackIcon: StructureIcons.ClipboardCheck
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

function createSectorElement(sector) {
    if (!sector.staff || sector.staff.length === 0) return document.createElement('div');

    const { layout, pairKind, staffCount } = classifySectorLayout(sector.staff);

    if (isHierarchicalMobileView()) {
        return createMobileSectorElement(sector, { layout, pairKind, staffCount });
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
        staffGrid.appendChild(createStaffBadge(person));
    });

    return sectorDiv;
}

function createMobileSectorElement(sector, { layout, pairKind, staffCount }) {
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
        staffGrid.appendChild(createStaffBadge(person));
    });

    return sectorDiv;
}

function createStaffBadge(person) {
    const badge = document.createElement('div');
    const isCoord = person.isCoordinator;

    badge.className = `staff-badge ${isCoord ? 'coordinator' : ''}`;

    badge.innerHTML = `
        ${renderStructureAvatar({
            className: 'staff-icon-circle',
            name: person.name,
            uid: person.uid,
            fallbackIcon: isCoord ? StructureIcons.ClipboardCheck : StructureIcons.User
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
