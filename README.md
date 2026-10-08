# Analog Memory

Studio mobile-first pour mémoriser les modules, presets, patches et sons d'un système analogique/Eurorack.

La structure musicale comporte trois niveaux :

- **SET** : le morceau complet, avec BPM, gamme/tonalité, musiciens, métadonnées, fichiers MIDI et un module **MASTER CLOCK**.
- **PATCH** : un groupement nommé de modules, avec leurs setups, presets, notes et sons. Chaque instance de module appartient à un seul PATCH ; le même appareil de la bibliothèque peut avoir plusieurs instances.
- **CÂBLAGE** : les connexions entre modules, à l'intérieur d'un PATCH ou entre PATCHES, y compris les liaisons du MASTER CLOCK.

Crée un **SET**, puis ses **PATCHES**. Le bouton **Ajouter au PATCH sélectionné** de la bibliothèque ajoute un module au groupe actif. Le sélecteur **PATCH de…** déplace un module sans perdre ses réglages, sons ni câbles. Retirer un PATCH conserve ses modules dans un autre PATCH ; le dernier PATCH ne peut pas être retiré. La **Vue globale du SET** montre les groupes, tous les modules (même non câblés), les connexions, les canaux MIDI et le MASTER CLOCK, et peut être imprimée.

Sur le web sur grand écran, glisse la **poignée en haut à droite** d'une carte dans **Modules du PATCH** pour la placer avant ou après un autre module ; un trait indique la position de dépôt. La poignée permet aussi de déplacer le module avec les flèches gauche/droite du clavier. L'ordre est propre à chaque PATCH, synchronisé automatiquement dans le cloud et repris sur mobile, sans changer le module sélectionné, ses réglages, ses sons ni ses câbles. Le déplacement est bloqué pendant les opérations audio.

Sur **Android et sur téléphone (écran de 680 px ou moins)**, la création suit trois étapes : **choisir ou créer un SET**, **ajouter des modules au PATCH sélectionné**, puis **enregistrer son son** (ou importer un fichier audio). Les PATCHES sont aussi sélectionnables et éditables sur mobile. **Arrêter et enregistrer** conserve la prise ; les sons et modules sont synchronisés automatiquement dans le cloud. La navigation est bloquée pendant la capture, l'import ou la sauvegarde audio.

La préparation de la bibliothèque et la gestion du **câblage, des presets, du MASTER CLOCK, du MIDI et des métadonnées avancées** se font sur l'interface web sur grand écran, avec le même compte Google. Ces informations restent conservées lorsqu'un SET est ouvert ou complété sur mobile.

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

## Sauvegarde du projet

Pour synchroniser le projet dans `backup/`, exécuter `./scripts/update-backup.sh`. La copie exclut notamment `facades/`, les dépendances, les fichiers d'environnement locaux et les sorties de compilation.

La **bibliothèque Modules** est indépendante des SETS. Elle contient la définition réutilisable de chaque appareil : fabricant, modèle, photo de façade, boutons, faders et ports d'entrée/sortie. Une photo peut être analysée pour suggérer les contrôles et les connecteurs, à vérifier avant application. Les presets enregistrent les valeurs des contrôles d'un module.

Sur le web sur grand écran, **Mes modules** filtre les noms, fabricants et modèles, sans tenir compte des accents ou des majuscules. Le tri propose **Nom · A–Z** ou **Modifiés récemment**. La liste reste à côté de l'éditeur ; sur tablette elle forme une grille. Une prise audio en cours ou non sauvegardée bloque le changement de module. Sur mobile, l'étape **Ajouter des façades** propose directement les appareils de cette bibliothèque, sans ouvrir l'éditeur.

**Mes SETS** propose également des cartes, une recherche par nom, artiste, musiciens, projet, genre, tags, tonalité ou BPM et un tri alphabétique ou par modification récente. Clique sur une carte pour ouvrir le morceau ; **Mes SETS** dans la navigation revient à la liste en conservant recherche et tri. La navigation générale **Modules** reste disponible, ainsi que l'ajout de modules au PATCH actif.

Les listes de SETS et de modules utilisent un en-tête compact, sans grand titre ni bandeau cloud. Les boutons de création se trouvent avec les outils de recherche et de tri. L'état de synchronisation et la déconnexion restent dans la barre supérieure ; les erreurs cloud sont affichées séparément.

Tu peux ajouter la photo avant de renseigner le nom : le module est alors enregistré sous le nom provisoire **Nouveau module**. Le scan peut remplacer ce nom par celui de l'appareil détecté ; tu peux aussi le modifier manuellement.

Après connexion, l'espace personnel s'ouvre en pleine page sur **Mes SETS**. La navigation **Modules** ouvre la bibliothèque dans ce même espace, sans l'intégrer à la carte de connexion. La bibliothèque reste accessible avant de créer ou d'ouvrir un morceau.

Un **SET** référence les modules choisis et leur preset actif, organisés en PATCHES. Ses instances, câbles, MASTER CLOCK, notes, prises audio et fichiers MIDI restent propres au morceau. Le même module peut être utilisé dans plusieurs SETS sans recopier sa définition. Crée d'abord les modules dans la bibliothèque, puis ajoute-les au PATCH actif.

Dans Firestore, la bibliothèque se trouve sous `users/{userId}/modules/{moduleId}`, avec les presets dans `presets/{presetId}`. Un SET (format version 3) possède ses métadonnées sous `users/{userId}/sets/{setId}`, ses groupements dans `patches/{patchId}`, ses instances dans `moduleInstances/{instanceId}` et ses liaisons dans `cables/{cableId}`. L'API utilise `/api/sets`. Photos, enregistrements et fichiers MIDI sont stockés séparément dans Cloud Storage, avec leurs métadonnées dans Firestore.

Les anciens thèmes restent lisibles. À l'ouverture, chacun devient un SET avec un premier PATCH portant son ancien nom ; ses identifiants, métadonnées, réglages, câbles et médias sont conservés. La prochaine sauvegarde crée transactionnellement le SET dans la nouvelle collection. La liste déduplique les anciens thèmes migrés. Les anciens documents et blobs ne sont pas supprimés ; les médias existants restent accessibles. Une ancienne application ne peut plus écraser un thème déjà migré : elle reçoit un conflit et doit être mise à jour. Déployer le backend avant le nouveau client web/Android.

Chaque **câble** mémorise son **canal MIDI** (1 à 16, ou « Non défini / sans MIDI ») : plusieurs ports d'un même appareil peuvent ainsi utiliser des canaux différents. Le canal se règle à la création du câble ou sur une ligne existante sur le web sur grand écran. Les anciens canaux de façade sont transférés aux lignes existantes, sans écraser leurs canaux déjà renseignés ; les nouvelles lignes restent non définies. La duplication conserve ces réglages.

Le **MASTER CLOCK** se choisit au niveau du SET parmi tous les modules, quel que soit leur PATCH. Un seul appareil est maître, avec le BPM du morceau comme tempo de référence. Coche **Diffuser MASTER CLOCK** sur chaque ligne qui transporte l'horloge, y compris les relais MIDI THRU ou routeurs. L'horloge MIDI est indépendante du canal. Le plan imprimable affiche le maître, les canaux et la diffusion par ligne (traits pointillés). Déplacer le maître vers un autre PATCH conserve son rôle. Le retirer efface son rôle et les nouveaux câbles qui le référencent explicitement ; les anciennes liaisons textuelles restent conservées. Il s'agit de mémoriser la configuration, **pas d'envoyer réellement une horloge MIDI**.

La connexion Google est obligatoire : les SETS, réglages, commentaires, photos, fichiers MIDI et enregistrements sont stockés dans le cloud et partagés entre le web et Android avec le même compte. Ouvre un SET cloud existant ou crée-en un ; les changements et nouveaux médias sont synchronisés automatiquement. L'application n'a pas de mode hors ligne ni de sauvegarde locale persistante : une connexion Internet est nécessaire et les modifications en attente peuvent être perdues en quittant la page. Un conflit arrête l'écriture au lieu d'écraser silencieusement les données.

## SETS musicaux et socle cloud

Sur le web, toutes les informations du SET sont regroupées dans **Informations musicales et fichiers MIDI**, replié par défaut : **nom, tempo, tonalité, compteurs de modules et de prises, MASTER CLOCK, artiste/compositeur, musiciens, projet/album, genre, signature rythmique, état, projet/piste/scène Ableton, tags, notes et fichiers MIDI**. Le nom reste affiché comme titre de la session ; sa modification se fait dans ce panneau. Une référence Ableton est un nom, chemin ou lien ; elle ne constitue pas une intégration avec Live.

Un SET peut recevoir plusieurs fichiers MIDI `.mid` / `.midi` (10 Mio maximum par fichier), stockés dans Cloud Storage avec les photos et sons. Ils peuvent être téléchargés ou retirés ; leur lecture et l'envoi MIDI vers les appareils ne sont pas implémentés.

Le backend **Express / Cloud Run + Firestore + Cloud Storage privé** utilise des jetons Google vérifiés côté serveur, des données séparées par compte et un contrôle des conflits par révision. Le code inclut Google Sign-In sur le Web et avec le client natif Android ; le client Android exige son propre identifiant OAuth configuré avec le package et le SHA-1 de signature.

Voir [DEPLOIEMENT.md](./DEPLOIEMENT.md) pour les API Google Cloud à activer, les clients OAuth à créer, le schéma, les permissions et les limites de cette première étape. Utiliser Node **22.12+** pour le backend et la compilation.

Les modifications sont sauvegardées automatiquement dans le cloud. Sur le web sur grand écran, le bouton **SAVE**, en haut des réglages du module sélectionné, enregistre immédiatement les valeurs de la session, le câblage et les notes. **Enregistrer le preset** ajoute ces valeurs à la bibliothèque du module pour les réutiliser dans d'autres thèmes. L’état de sauvegarde reste visible sur mobile et signale les erreurs éventuelles.

Depuis un thème, **Enregistrer le preset** met à jour le preset sélectionné si son nom reste identique (les espaces en début et fin sont ignorés). Un nom différent crée un nouveau preset, conserve l'original et sélectionne le nouveau pour cette façade. Avec des réglages libres, un nouveau preset est créé.

Dans un thème, les photos des modules restent affichées dans la galerie, mais les réglages de la façade ne présentent que les boutons rotatifs et faders du preset, sans photo de référence, analyse IA, champ de modèle ni éditeur de connecteurs. Les photos, l'analyse IA et les connecteurs se gèrent uniquement dans **Modules** ; les connecteurs restent disponibles pour choisir les extrémités des patches dans le thème. La duplication conserve la photo et les connecteurs sans modifier leur définition. Dans la bibliothèque, la création d'un preset utilise les mêmes contrôles, avec une échelle de 0 à 100 % ; les contrôles non renseignés restent « À saisir ».

Dans **Modules > Presets**, le bouton **Modifier** charge le nom, les notes et les réglages d'un preset existant dans l'éditeur. **Enregistrer les modifications** met à jour ce même preset, sans doublon ; **Annuler l'édition** revient à la création d'un nouveau preset sans modifier celui enregistré. Les réglages déjà utilisés dans les thèmes ne sont pas remplacés automatiquement : sélectionne à nouveau le preset dans le thème pour appliquer sa nouvelle version.

Le bouton **Voir** affiche directement sous le preset ses boutons rotatifs, faders, valeurs et notes en lecture seule. Un seul aperçu est ouvert à la fois ; **Masquer** le referme. Consulter un preset ne modifie pas le brouillon de l'éditeur et ne l'applique pas au thème.

Chaque preset enregistré peut avoir **un son de référence**, indépendant des prises audio du thème. Ouvre **Modules > Presets > Voir**, ou sélectionne un preset dans le thème, puis **Enregistrer un son** ou **Importer un son**. Après la capture, écoute la prise et clique sur **Sauvegarder le son du preset**. Le son précédent n'est remplacé qu'après une sauvegarde réussie ; une erreur laisse la prise disponible pour réessayer. **Retirer le son** retire son association au preset. Les réglages et les notes sont préservés lors de ces opérations.

Sur **Android**, la capture utilise l'autorisation microphone de la WebView Capacitor (`RECORD_AUDIO`, déjà déclarée). Branche l'interface audio USB-C avant la capture et choisis l'entrée après **Détecter les entrées** ; les noms peuvent devenir visibles seulement après la première autorisation microphone. La capture désactive les traitements de voix (réduction de bruit, gain automatique, annulation d'écho). L'entrée réellement disponible dépend du téléphone et de l'interface. Le passage en arrière-plan arrête la prise, à écouter et sauvegarder au retour ; reste sur le preset jusqu'à la sauvegarde. Aucun enregistrement en arrière-plan n'est proposé.

Les sons de presets sont privés, stockés avec les médias du module et accessibles avec le même compte sur Web et Android. Formats : M4A/MP4, WAV, MP3, AAC, FLAC, OGG et WebM ; limite **25 Mio**, photos toujours limitées à **8 Mio**. Modifier un preset conserve son son ; enregistrer une variante sous un autre nom depuis un thème crée un preset sans son, à enregistrer séparément. Les médias retirés ou remplacés restent dans le stockage privé, comme les anciennes photos, sans être référencés par le preset.

## Analyse IA des appareils

Le bouton **Configuration** en haut à droite sur le web sur grand écran permet d'enregistrer, remplacer ou supprimer une **clé API Gemini personnelle** obtenue dans Google AI Studio. Le champ est masqué, avec une option pour afficher la saisie. La clé est conservée côté serveur dans la configuration privée du compte, partagée entre Web et Android ; elle n'est jamais renvoyée par l'API de configuration, stockée dans le navigateur ni exportée avec les thèmes. Seul son statut est affiché. L'enregistrement vérifie le format, pas la validité auprès de Gemini ; les refus et quotas sont signalés lors des analyses.

Les deux fonctions IA utilisent en priorité la clé personnelle. Sans celle-ci, la clé serveur `GEMINI_API_KEY` reste utilisée si disponible. Les quotas et frais d'une clé personnelle dépendent du projet Google de l'utilisateur. Cette fonctionnalité nécessite le déploiement de la nouvelle API. Pour utiliser la configuration cloud en développement, configure `VITE_API_URL` vers cette API ; le relais IA utilise cette même adresse en l'absence de `VITE_AI_SERVER_URL`.

En développement, ajoute une clé Gemini **fraîche** au terminal avant de lancer Vite (la clé est lue uniquement côté serveur, jamais intégrée au JavaScript envoyé au navigateur) :

```sh
export GEMINI_API_KEY="ta-cle-gemini"
npm run dev
```

Dans la bibliothèque **Modules**, ajoute une photo réelle du panneau puis sélectionne **Repérer les contrôles et ports**. Gemini 3.1 Flash-Lite identifie le module, liste les boutons rotatifs et les potentiomètres linéaires (curseurs/faders) réellement présents ; il estime l’angle du repère des premiers et la position de la capsule des seconds (0 % = butée basse ou gauche, 100 % = haute ou droite). Le scan repère aussi les ports, leurs noms et leur sens **IN/OUT**. Les estimations doivent être vérifiées ; les contrôles et ports restent modifiables dans la bibliothèque. Les photos sont envoyées à Gemini pour analyse, puis conservées avec le module dans le cloud.

Le relais IA est servi par l’API Express en production et par le relais Vite en développement local. L’APK de production utilise l’API HTTPS Cloud Run ; aucune clé Gemini n'est intégrée dans l'application mobile.

Les appareils sans potentiomètres ni curseurs, comme le routeur MIDI **Midihub**, sont également acceptés : une analyse peut contenir une liste de contrôles vide. Aucun contrôle Rings n’est ajouté par défaut. Les connecteurs visibles (jacks audio/CV, MIDI DIN IN/OUT/THRU, USB MIDI/audio, etc.) sont reconnus avec leurs lettres ou numéros lorsqu’ils sont lisibles. L’absence de contrôles ou de connecteurs visibles n’est pas une erreur de format ; les suggestions doivent toujours être vérifiées avant enregistrement.

Les ports **USB de données** sont traités comme **IN/OUT** : un seul connecteur physique est enregistré et proposé à la fois comme source et comme destination du patch. Cette règle s’applique au scan, à la recherche des connecteurs cachés, à la saisie manuelle et aux connecteurs déjà enregistrés dont le nom contient USB (ex. « USB-C », « USB MIDI », « microUSB »). Pour ajouter un port manuellement, nomme le connecteur USB ; son sens devient automatiquement IN/OUT. L’option **Entrée / sortie · IN/OUT** est aussi disponible pour les autres connecteurs bidirectionnels. Les prises USB réservées uniquement à l’alimentation sont exclues de l’analyse IA ; les prises combinant données et alimentation sont incluses.

Après le scan de la photo, une seconde requête Gemini avec recherche web (`/api/rings/hidden-jacks`) peut chercher la fiche technique de l’appareil pour lister les connecteurs absents du panneau : face arrière, côtés, MIDI IN/OUT/THRU, USB, expression, etc. Les suggestions de cette recherche restent à vérifier et peuvent être ajoutées dans la liste des ports du module.

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
