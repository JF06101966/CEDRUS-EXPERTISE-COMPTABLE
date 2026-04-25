# 🌲 CEDRUS Expertise Comptable & Conseils

Site vitrine moderne et professionnel pour le cabinet d'expertise comptable CEDRUS, spécialisé dans l'accompagnement des dirigeants de demain.

## 🎯 Présentation

CEDRUS est un cabinet d'expertise comptable de nouvelle génération, créé par Jean-François Le Gall avec plus de 30 ans d'expérience. Le cabinet se distingue par son approche "Ancrés & Agiles" - ancrés dans les fondamentaux du métier tout en intégrant l'innovation technologique.

## ✨ Fonctionnalités

- **Design moderne et responsive** : Mobile-first avec adaptation desktop
- **Navigation intuitive** : Menu sticky avec navigation mobile
- **Animations fluides** : Apparition progressive des éléments au scroll
- **Formulaire de contact** : Modale de prise de RDV avec validation
- **Carte interactive** : Intégration Google Maps
- **SEO optimisé** : Meta tags, Open Graph et JSON-LD
- **Accessibilité** : Conformité WCAG AA avec focus visible et navigation clavier

## 🛠️ Technologies utilisées

- **HTML5** : Structure sémantique et accessible
- **TailwindCSS** : Framework CSS utilitaire via CDN
- **JavaScript vanilla** : Pas de framework, code léger et performant
- **Google Fonts** : Playfair Display (titres) et Inter (texte)
- **Google Maps** : Intégration iframe pour la localisation

## 📁 Structure du projet

```
Cedrus/
├── index.html              # Page d'accueil
├── cabinet.html            # Présentation du cabinet
├── missions.html           # Services et missions
├── honoraires.html         # Tarifs et conditions
├── contact.html            # Contact et prise de RDV
├── assets/
│   ├── styles.css          # Styles personnalisés et variables CSS
│   ├── main.js             # JavaScript principal
│   └── img/
│       └── logo-cedrus.png # Logo du cabinet (à ajouter)
└── README.md               # Documentation du projet
```

## 🎨 Palette de couleurs

- **Cedrus 600** : `#3E9364` (vert profond - primaire)
- **Cedrus 500** : `#4FA36F` (vert - secondaire)
- **Cedrus 200** : `#BFE6AE` (vert clair - accent)
- **Ink** : `#0B1420` (presque noir bleu - texte)
- **Muted** : `#6B7280` (gris - texte secondaire)
- **Paper** : `#F8FAF9` (blanc cassé - fond)

## 🔧 Installation et utilisation

1. **Cloner le projet** :
   ```bash
   git clone [url-du-repo]
   cd Cedrus
   ```

2. **Ajouter le logo** :
   - Placer le fichier `logo-cedrus.png` dans le dossier `assets/img/`
   - Format recommandé : PNG avec fond transparent, hauteur 200px minimum

3. **Ouvrir le site** :
   - Double-cliquer sur `index.html` ou
   - Utiliser un serveur local (recommandé) :
     ```bash
     # Avec Python
     python -m http.server 8000
     
     # Avec Node.js
     npx serve .
     
     # Avec PHP
     php -S localhost:8000
     ```

4. **Accéder au site** :
   - Ouvrir `http://localhost:8000` dans votre navigateur

## 📱 Responsive Design

Le site est conçu pour être parfaitement responsive sur tous les appareils :

- **Mobile** : < 768px (iPhone, Android)
- **Tablet** : 768px - 1024px (iPad)
- **Desktop** : > 1024px (PC, Mac)

## 🚀 Fonctionnalités JavaScript

### Menu mobile
- Bouton hamburger avec animation
- Navigation overlay avec fermeture au clic
- Gestion du scroll du body

### Animations
- Apparition progressive des éléments au scroll
- Transitions fluides sur les interactions
- Hover effects sur les cartes et boutons

### Modale de RDV
- Ouverture/fermeture avec animations
- Validation des champs obligatoires
- Toast de confirmation
- Fermeture avec Escape ou clic overlay

### Navigation
- Smooth scroll vers les ancres
- Mise en évidence de la page active
- Navigation mobile intégrée

## 🔍 SEO et Accessibilité

### SEO
- Meta tags optimisés pour chaque page
- Open Graph pour les réseaux sociaux
- JSON-LD Schema Organization
- Structure HTML sémantique
- Images avec alt descriptifs

### Accessibilité
- Navigation au clavier
- Focus visible sur tous les éléments interactifs
- Labels et aria-labels appropriés
- Contraste AA respecté
- Ordre de tabulation logique

## 📊 Performance

- **TailwindCSS via CDN** : Pas de build nécessaire
- **Images optimisées** : Lazy loading et compression
- **JavaScript léger** : Pas de framework lourd
- **Polices optimisées** : Google Fonts avec display=swap

## 🌐 Compatibilité navigateurs

- **Chrome** : 90+
- **Firefox** : 88+
- **Safari** : 14+
- **Edge** : 90+
- **Mobile** : iOS Safari 14+, Chrome Mobile 90+

## 📝 Contenu

Le site respecte exactement le contenu fourni par le client :

- **Accueil** : Vision, approche, philosophie et engagements
- **Cabinet** : Portrait de Jean-François Le Gall et approche
- **Missions** : Services comptables, fiscaux et sociaux
- **Honoraires** : Tarifs transparents avec conditions
- **Contact** : Coordonnées, carte et formulaire de RDV

## 🔧 Personnalisation

### Modifier les couleurs
Éditer les variables CSS dans `assets/styles.css` :
```css
:root {
  --cedrus-600: #3E9364;
  --cedrus-500: #4FA36F;
  --cedrus-200: #BFE6AE;
  /* ... */
}
```

### Modifier les polices
Changer les imports Google Fonts dans `assets/styles.css` :
```css
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
```

### Ajouter des pages
1. Créer un nouveau fichier HTML
2. Copier la structure de navigation et footer
3. Mettre à jour les liens dans `assets/main.js`

## 📞 Support

Pour toute question ou modification :
- **Email** : contact@cedrus-expertise.fr
- **Adresse** : 8 AVENUE DES TERRASSES, 92430 MARNES-LA-COQUETTE

## 📄 Licence

© 2024 CEDRUS EXPERTISE COMPTABLE & CONSEILS. Tous droits réservés.

---

**Développé avec ❤️ pour CEDRUS Expertise Comptable & Conseils** 