// CEDRUS - JavaScript principal
document.addEventListener('DOMContentLoaded', function() {

    
    // Menu mobile
    const mobileMenuButton = document.querySelector('[data-mobile-menu]');
    const mobileMenu = document.querySelector('[data-mobile-menu-panel]');
    const mobileMenuOverlay = document.querySelector('[data-mobile-menu-overlay]');
    
    if (mobileMenuButton && mobileMenu) {
        mobileMenuButton.addEventListener('click', function() {
            const isOpen = mobileMenu.classList.contains('hidden');
            
            if (isOpen) {
                // Ouvrir le menu
                mobileMenu.classList.remove('hidden');
                mobileMenuOverlay?.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
                mobileMenuButton.setAttribute('aria-expanded', 'true');
            } else {
                // Fermer le menu
                mobileMenu.classList.add('hidden');
                mobileMenuOverlay?.classList.add('hidden');
                document.body.style.overflow = '';
                mobileMenuButton.setAttribute('aria-expanded', 'false');
            }
        });
        
        // Fermer le menu en cliquant sur l'overlay
        mobileMenuOverlay?.addEventListener('click', function() {
            mobileMenu.classList.add('hidden');
            mobileMenuOverlay.classList.add('hidden');
            document.body.style.overflow = '';
            mobileMenuButton.setAttribute('aria-expanded', 'false');
        });
    }
    
    // Smooth scroll pour les liens d'ancrage
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                
                // Fermer le menu mobile si ouvert
                if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
                    mobileMenu.classList.add('hidden');
                    mobileMenuOverlay?.classList.add('hidden');
                    document.body.style.overflow = '';
                    mobileMenuButton.setAttribute('aria-expanded', 'false');
                }
            }
        });
    });
    
    // Animation d'apparition au scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-fade-in-up');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // Observer tous les éléments avec la classe .animate-on-scroll
    document.querySelectorAll('.animate-on-scroll').forEach(el => {
        observer.observe(el);
    });
    
    // Navigation active
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('[data-nav-link]');
    
    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('text-cedrus-600', 'font-medium');
            link.setAttribute('aria-current', 'page');
        }
    });
    
    // Gestion des modales
    const modalTriggers = document.querySelectorAll('[data-modal-trigger]');
    const modals = document.querySelectorAll('[data-modal]');
    
    modalTriggers.forEach(trigger => {
        trigger.addEventListener('click', function(e) {
            e.preventDefault();
            const modalId = this.getAttribute('data-modal-trigger');
            const modal = document.querySelector(`[data-modal="${modalId}"]`);
            
            if (modal) {
                modal.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
                
                // Focus sur le premier input
                const firstInput = modal.querySelector('input, textarea, select');
                if (firstInput) {
                    firstInput.focus();
                }
            }
        });
    });
    
    // Fermer les modales
    document.addEventListener('click', function(e) {
        if (e.target.hasAttribute('data-modal-close') || e.target.hasAttribute('data-modal')) {
            const modal = e.target.closest('[data-modal]');
            if (modal) {
                modal.classList.add('hidden');
                document.body.style.overflow = '';
            }
        }
    });
    
    // Fermer les modales avec Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            modals.forEach(modal => {
                if (!modal.classList.contains('hidden')) {
                    modal.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            });
        }
    });
    
    // Toast notifications
    window.showToast = function(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `fixed top-4 right-4 z-50 px-6 py-3 rounded-lg text-white font-medium transition-all transform translate-x-full ${
            type === 'success' ? 'bg-cedrus-500' : 'bg-red-500'
        }`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        // Animation d'entrée
        setTimeout(() => {
            toast.classList.remove('translate-x-full');
        }, 100);
        
        // Auto-suppression après 4 secondes
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 4000);
    };
    
    // Validation des formulaires
    const forms = document.querySelectorAll('form[data-validate]');
    
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const formData = new FormData(this);
            const isValid = validateForm(this);
            
            if (isValid) {
                // Simulation d'envoi
                showToast('Message envoyé (démo)', 'success');
                this.reset();
                
                // Fermer la modale si elle existe
                const modal = this.closest('[data-modal]');
                if (modal) {
                    modal.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            }
        });
    });
    
    function validateForm(form) {
        let isValid = true;
        const requiredFields = form.querySelectorAll('[required]');
        
        requiredFields.forEach(field => {
            if (!field.value.trim()) {
                isValid = false;
                field.classList.add('border-red-500');
                
                // Retirer la classe d'erreur après saisie
                field.addEventListener('input', function() {
                    this.classList.remove('border-red-500');
                }, { once: true });
            }
        });
        
        return isValid;
    }
    
    // Lazy loading des images
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.remove('lazy');
                    imageObserver.unobserve(img);
                }
            });
        });
        
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    }
    
    // Amélioration de l'accessibilité
    document.querySelectorAll('[data-tooltip]').forEach(element => {
        element.addEventListener('focus', function() {
            const tooltip = document.createElement('div');
            tooltip.className = 'absolute z-50 px-2 py-1 text-sm text-white bg-ink rounded shadow-lg';
            tooltip.textContent = this.getAttribute('data-tooltip');
            tooltip.style.top = '-40px';
            tooltip.style.left = '0';
            
            this.style.position = 'relative';
            this.appendChild(tooltip);
        });
        
        element.addEventListener('blur', function() {
            const tooltip = this.querySelector('div');
            if (tooltip) {
                this.removeChild(tooltip);
            }
        });
    });
}); 