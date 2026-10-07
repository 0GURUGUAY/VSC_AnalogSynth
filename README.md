# Analog Memory

Prototype mobile-first pour mémoriser les réglages, le câblage et le son d'un patch Eurorack.

## Démarrer en développement

```sh
npm install
npm run dev
```

## Construire pour le web / Android

```sh
npm run build
npm run cap:add:android
npm run cap:sync
npm run cap:open:android
```

Le prototype démarre avec le set **Thème 1** (90 BPM, E majeur) et le module Mutable Instruments Rings.

Chaque module contient une liste de **façades** affichées en vignettes. Une façade regroupe la photo du panneau, la position des contrôles, le câblage, les notes et les sons enregistrés. Quand tu sélectionnes une vignette, ses réglages et ses sons s'affichent ; le bouton ▶ de la vignette joue directement le dernier son. « Nouvelle façade » ouvre l'appareil photo, puis les prises audio (capture ou import) sont rattachées à la façade sélectionnée. Les anciennes données (module unique + instantanés) sont converties automatiquement en façades au premier lancement.

Les données et fichiers média sont stockés localement dans IndexedDB ; ils ne sont pas encore synchronisés avec une base distante.

Les modifications sont sauvegardées automatiquement. Le bouton **SAVE**, en haut des réglages de la façade sélectionnée, permet aussi d’enregistrer immédiatement les valeurs, le modèle, le câblage et les notes. Une confirmation apparaît uniquement après l’écriture dans le stockage local ; l’état de sauvegarde reste visible sur mobile et signale les erreurs éventuelles. SAVE met à jour la façade existante, sans en créer une nouvelle.

## Analyse IA du Rings

En développement, ajoute une clé Gemini **fraîche** au terminal avant de lancer Vite (la clé est lue uniquement côté serveur, jamais intégrée au JavaScript envoyé au navigateur) :

```sh
export GEMINI_API_KEY="ta-cle-gemini"
npm run dev
```

Dans l’application, ajoute une photo réelle de la façade puis sélectionne **Analyser avec l’IA**. Gemini 3.1 Flash-Lite identifie le module, liste les boutons rotatifs et les potentiomètres linéaires (curseurs/faders) réellement présents sur la façade ; il estime l’angle du repère des premiers et la position de la capsule des seconds (0 % = butée basse ou gauche, 100 % = haute ou droite). Le scan repère aussi les prises jack femelles, reprend leur nom imprimé et propose leur sens **IN** ou **OUT**. En cliquant sur **Appliquer**, les boutons et les jacks de la façade sont enregistrés d’après cette analyse (Rings par défaut tant qu’aucune analyse n’a été appliquée). L’application convertit ensuite l’angle en position sur l’arc mécanique : 7 h = 0 %, 12 h = 50 %, 5 h = 100 %. Les noms et directions des jacks restent modifiables ; les sorties et entrées apparaissent comme suggestions dans les champs de câblage, qui acceptent toujours une saisie libre pour les autres appareils. Le résultat est présenté comme une estimation à confirmer avant modification. Les photos sont envoyées à Gemini pour analyse ; le reste des données reste stocké localement.

Cette intégration est un relais de développement Vite, pas un backend de production. Avant de distribuer l’application Android ou de l’utiliser hors de ce serveur, il faudra déployer le relais sur un service HTTPS (par exemple Google Cloud Run) et faire pointer l’application vers ce service ; ne place jamais la clé dans l’application mobile.

Dès qu’une photo est ajoutée (nouvelle façade comprise), l’analyse se lance automatiquement, puis une seconde requête Gemini avec recherche web (`/api/rings/hidden-jacks`) cherche la fiche technique de l’appareil (module, pédale, synthétiseur) pour lister les connecteurs absents de la façade : face arrière, côtés, MIDI IN/OUT/THRU, USB, expression, etc. Ils sont ajoutés aux prises proposées avec leur emplacement (ex. « Face arrière ») et appliqués avec **Appliquer**. Si la recherche échoue ou si l’appareil n’est pas reconnu, seule l’analyse de la façade est proposée.

### Tester l’IA dans l’APK sur le Wi-Fi local

L’APK ne contient pas le relais IA. Le Mac et le téléphone doivent être sur le même Wi-Fi et le serveur Vite doit rester lancé avec `GEMINI_API_KEY` configurée côté serveur.

1. Trouve l’adresse du Mac avec `ipconfig getifaddr en0`.
2. Crée `.env.mobile-local` avec `VITE_AI_SERVER_URL=http://ADRESSE_DU_MAC:5173` (utilise le port réellement affiché par Vite).
3. Dans `android/app/src/debug/res/xml/local_ai_network_security.xml`, remplace l’adresse du domaine par celle du Mac. Cette exception HTTP ne s’applique qu’aux APK **debug**, et uniquement à cette adresse.
4. Lance `npm run dev` sur le Mac, puis `npm run build:mobile-local` dans un autre terminal.
5. Construis l’APK **debug** dans Android Studio (`npm run cap:open:android`) et réinstalle-le sur le téléphone.

Le client Android utilise le transport HTTP natif Capacitor ; aucune autorisation de contenu mixte dans la WebView ni ouverture CORS du relais n’est nécessaire. Autorise les connexions entrantes du serveur dans le pare-feu du Mac si nécessaire. Si l’adresse du Mac change, répète la configuration et la construction. Les photos transitent sans chiffrement en mode local : réserve ce test à un réseau de confiance, et n’expose pas Vite sur Internet.

### Serveur HTTPS pour une APK distribuée

Configure `VITE_AI_SERVER_URL=https://ton-serveur` dans `.env.local` avant `npm run build` et `npm run cap:sync`. Cette variable contient uniquement la **base de l’URL** ; le client ajoute `/api/rings/analyze`. L’URL est intégrée lors de la construction : toute modification nécessite de reconstruire et réinstaller l’APK. Un serveur statique ou `vite preview` ne fournit pas le relais IA. Déploie un véritable backend HTTPS avec authentification et limites d’utilisation avant une distribution ; la clé Gemini reste exclusivement sur ce backend.

Sans URL configurée, le navigateur continue d’utiliser le relais Vite sur la même origine ; l’APK affiche une erreur de configuration explicite au lieu de tenter de lire sa page HTML comme du JSON. Le mode normal refuse les URL HTTP ; elles sont réservées au mode `mobile-local`.

La capture audio utilise `getUserMedia` et `MediaRecorder` du navigateur/WebView Android. Elle dépend de la prise en charge USB audio de la version Android, du WebView, de l'application/hôte et des autorisations micro. Le flux demande de désactiver réduction de bruit et gain automatique ; Android peut néanmoins traiter l'entrée. L'import d'enregistrements existants est également disponible.
