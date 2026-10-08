# Socle cloud Analog Memory

## État de la version

Google Sign-In, l'isolation par compte, les thèmes cloud et le client Android
étaient déjà en production. Cette version ajoute la bibliothèque de modules,
les presets, les instances de module par thème et la persistance des patches.
Mettre le backend à jour avant de distribuer l'APK qui consomme les nouveaux
endpoints.

L'application n'a pas de mode local ni de fonctionnement hors ligne. Au premier
lancement de cette version, l'ancienne base IndexedDB `analog-memory` est
supprimée. Les thèmes cloud restent privés par compte Google.

## Architecture retenue

Comme Inventaire IA :

- React/Vite pour le web, Capacitor pour Android ;
- Express sur Cloud Run, qui sert aussi le site web ;
- Firestore **Native**, base `(default)`, commune aux deux clients ;
- Google Sign-In : validation serveur des ID tokens Google ;
- Gemini côté serveur seulement.

En complément, un bucket **Cloud Storage privé** reçoit photos, sons et MIDI.
Ces fichiers ne sont pas stockés en base64 dans Firestore et ne dépendent pas du
disque éphémère de Cloud Run.

Chaque compte Google possède ses thèmes. Web et mobile retrouvent les mêmes
données en utilisant le même compte. Aucune collaboration entre comptes pour
l'instant. Le compte de service Cloud Run utilise les Application Default
Credentials : pas de clé JSON à télécharger ni à intégrer à l'APK.

## 1. Services/API Google Cloud à activer

Créer de préférence un projet distinct de celui d'Inventaire IA, avec facturation.
Dans **API et services → Bibliothèque**, activer :

| API | Identifiant | Usage |
| --- | --- | --- |
| Cloud Run Admin API | `run.googleapis.com` | Hébergement web/API |
| Cloud Build API | `cloudbuild.googleapis.com` | Compilation depuis les sources |
| Artifact Registry API | `artifactregistry.googleapis.com` | Images construites |
| Cloud Firestore API | `firestore.googleapis.com` | Thèmes, façades et réglages |
| Cloud Storage API | `storage.googleapis.com` | Photos, audio et MIDI |
| Secret Manager API | `secretmanager.googleapis.com` | Clé Gemini |
| IAM API | `iam.googleapis.com` | Compte de service dédié |
| Generative Language API | `generativelanguage.googleapis.com` | Analyse Gemini, si activée |

Dans Cloud Shell, alternative à l'activation manuelle :

```sh
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com \
  storage.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
  generativelanguage.googleapis.com
```

Google Sign-In se configure dans **Google Auth Platform** : il n'y a pas d'API
« SSO Google » supplémentaire à activer. Ce socle n'utilise pas Firebase
Authentication / Identity Platform, donc `identitytoolkit.googleapis.com` n'est
pas nécessaire. Google Drive et les API Ableton ne sont pas nécessaires non plus :
la référence Ableton est une information, pas une connexion au logiciel.

## 2. Base et fichiers

1. La base `(default)` du projet de démonstration a été créée en **`nam5`**
   (multirégion États-Unis). Cette localisation est immuable.
2. Le service Cloud Run et le bucket du projet ont été créés en **`us-central1`**.
   Firestore `nam5` et Cloud Run `us-central1` sont deux localisations
   différentes ; les accès inter-régions peuvent ajouter latence et frais de
   transfert. Ne pas tenter de recréer la base : une autre localisation demande
   un nouveau projet/base.
3. Le bucket configuré est `gen-lang-client-0885269358-analog-media`, en
   `us-central1`, avec accès uniforme et prévention de l'accès public.
4. Ne donner aucun rôle à `allUsers` / `allAuthenticatedUsers` sur le bucket ou
   la base. Les clients passent uniquement par le backend.
5. Si le projet est aussi administré via Firebase, appliquer les règles de
   [firestore.rules](./firestore.rules), qui interdisent les accès directs aux
   clients. Elles ne bloquent pas le SDK Admin, protégé par IAM.

### Schéma courant

Pour les sons de presets, déployer le backend et mettre à jour l'APK ensemble :
le téléversement des médias de module accepte désormais les fichiers audio
(25 Mio, photos toujours 8 Mio), puis `PUT /api/modules/:moduleId/presets/:presetId/audio`
associe leurs métadonnées au preset ou retire l'association avec `{"audio":null}`.
Cette mise à jour est transactionnelle et ne remplace pas le nom, les valeurs ni
les notes du preset. Les anciens presets sans champ `audio` restent compatibles.
Les blobs retirés ou remplacés restent privés dans le bucket ; leur nettoyage
ne doit supprimer que les objets non référencés.

```text
users/{googleSub}
  modules/{moduleId UUID}
    name, manufacturer, model, photoId, controls[], jacks[], createdAt, updatedAt
    presets/{presetId UUID}
      name, values{controlId: 0..100|null}, notes, createdAt, updatedAt
      audio? {id, name, mimeType, durationSeconds, createdAt}
    media/{mediaId UUID}
      mimeType, sizeBytes, createdAt
  sets/{setId UUID}
    version: 3
    set: nom, BPM, tonalité, artiste, musiciens, projet/album, genre,
         signature rythmique, état, références Ableton, tags, notes,
         midiFiles[] (métadonnées et identifiants), masterClockFacadeId (optionnel)
    moduleInstanceIds[]: ordre des modules du SET
    moduleIds[]: références aux modules de la bibliothèque
    patchIds[]: ordre des groupements PATCH
    activePatchId, cableIds[]
    revision, createdAt, updatedAt
    moduleInstances/{instanceId UUID}
      moduleId, presetId, nom dans le SET, valeurs de session, notes
      recordings[]: métadonnées des sons
    patches/{patchId UUID}
      id, name, notes, moduleInstanceIds[]
    cables/{cableId UUID}
      moduleInstanceId, source, destination, couleur, midiChannel (1..16, optionnel),
      carriesClock (diffusion MASTER CLOCK, optionnel)
      sourceInstanceId?, sourcePortId?, destinationInstanceId?, destinationPortId?
    media/{mediaId UUID}
      mimeType, sizeBytes, createdAt

Cloud Storage :
  users/{googleSub}/modules/{moduleId}/media/{mediaId}
  users/{googleSub}/themes/{themeId}/media/{mediaId}
```

Le **SET est la racine**, avec une clé UUID et non le nom :
le renommage ne casse aucun lien et deux morceaux peuvent porter le même titre.
L'identifiant propriétaire vient exclusivement du jeton Google validé, jamais du
corps de la requête.

Le MASTER CLOCK référence une instance de module du SET par UUID (un seul
maître). Les canaux MIDI et la diffusion d'horloge restent réglés par câble.
Ces réglages documentent le câblage ; ils ne génèrent aucun signal MIDI.

Déployer le backend avant le client : `/api/sets` expose le nouveau modèle ;
les anciennes routes `/api/themes` restent compatibles. Les anciens thèmes
version 2 sont ouverts comme des SETS à un PATCH et sauvegardés dans `sets`
sans suppression des documents historiques. Les révisions contrôlent aussi
la première migration. La liste fusionne les deux collections, en donnant
priorité au SET migré. Les écritures version 2 sur un thème migré sont refusées.
Les blobs gardent leur chemin historique `themes/{setId}/media` (y compris les
nouveaux médias) pour préserver les identifiants et éviter une copie destructrice ;
la lecture retrouve aussi les métadonnées historiques. Les nouveaux câbles
référencent modules et ports par UUID/identifiant, sans dépendre des noms.

Les définitions de contrôle et de port ne sont stockées qu'une fois dans la
bibliothèque. Les presets appartiennent à leur module ; une instance de thème
référence un preset et conserve ses propres valeurs de session. Les patches
sont des documents séparés par thème. Les anciennes collections `facades`
restent lisibles à la transition ; elles ne sont pas effacées globalement au
déploiement, afin de ne pas supprimer les essais ou les données d'autres
comptes Google par inadvertance. La suppression des essais doit viser le compte
de test confirmé par son propriétaire. Les fichiers MIDI restent rattachés au
thème. La référence Ableton accepte un nom de projet, chemin ou URL ; elle
n'importe pas le fichier `.als` et ne permet pas de l'ouvrir sur un autre appareil.

Les écritures des thèmes/façades sont transactionnelles. Une révision attendue
empêche qu'un appareil écrase silencieusement les changements de l'autre :
un conflit retourne **409** et impose une relecture. Ce n'est pas encore une
fusion automatique ou une synchronisation hors ligne.

## 3. Google SSO : identifiants à créer

Dans Google Auth Platform :

1. Configurer Branding, Audience et les scopes `openid`, `email`, `profile`.
2. Si application externe en mode test, ajouter les comptes de test nécessaires.
3. Créer un **client OAuth Application Web**.
   - Origine JavaScript locale : `http://localhost:5173`.
   - Ajouter l'origine HTTPS Cloud Run après le premier déploiement.
   - Le bouton web utilise Google Identity Services et transmet un ID token ;
     aucun client secret n'est nécessaire dans le navigateur.
4. Créer un **client OAuth Android** :
   - package : `com.maxpatissier.analogmemory` ;
   - SHA-1 du certificat qui signe l'APK debug, puis un client/configuration
     pour la signature release si elle est différente ;
   - ne pas reprendre le package d'Inventaire IA.
5. L'intégration native reçoit un ID token dont l'audience est le **client Web**,
   comme le backend. Le client Android vérifie le package et le SHA-1 ; il doit
   exister, mais son ID n'est pas transmis au code.
6. Ne pas tenter le SSO dans la WebView Android : l'APK utilise le plugin natif
   Google Sign-In.

### Configuration Android nécessaire avant le premier login natif

Dans le terminal du Mac, récupère le SHA-1 du certificat debug :

```sh
keytool -list -v \
  -keystore "$HOME/.android/debug.keystore" \
  -alias androiddebugkey \
  -storepass android \
  -keypass android
```

Dans **Google Auth Platform → Clients → Créer un client → Android**, indique le
package `com.maxpatissier.analogmemory` et le SHA-1 debug. Pour une APK signée
différemment, crée un autre client Android avec le SHA-1 de release. Le plugin
utilise toujours l'ID client Web pour demander l'ID token.

Le backend vérifie signature, émetteur, audience, expiration et email vérifié.
Il refuse aussi les jetons non validés en développement. Pour ce socle, chaque
appel contient `Authorization: Bearer ID_TOKEN_GOOGLE`. Aucun jeton de session
maison n'est encore émis ; le client devra gérer expiration et reconnexion.

## 4. Compte de service et permissions

Créer un compte `analog-memory-runtime`, distinct du compte de build.

Permissions **runtime** :

- `roles/datastore.user` sur le projet ;
- `roles/storage.objectUser` sur **ce bucket seulement** ;
- `roles/secretmanager.secretAccessor` sur **le secret Gemini seulement**, si utilisé.

Le compte runtime n'a pas besoin d'Editor ou Owner.

Pour un déploiement `--source`, le compte de build réellement utilisé doit avoir
`roles/run.builder` sur le projet. Les nouveaux projets utilisent généralement
le compte Compute Engine par défaut (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) :
vérifier le compte dans Cloud Build plutôt que supposer qu'il possède Editor.
Le compte de la personne qui déploie doit pouvoir déployer depuis les sources
(`roles/run.sourceDeveloper`, `roles/serviceusage.serviceUsageConsumer`) et
utiliser le compte runtime (`roles/iam.serviceAccountUser` sur ce compte).
La création des ressources et la modification des politiques IAM demandent
des permissions d'administration supplémentaires.

## 5. Configuration et déploiement

Node **22.12+** est nécessaire. Le [Dockerfile](./Dockerfile) compile le client
et le backend puis n'embarque que les dépendances de production. Le bundle serveur
est séparé des fichiers publics et n'est pas servi au navigateur.

Pour développer le backend :

```sh
cp .env.example .env
# Remplir les valeurs ; ne pas committer ce fichier.
gcloud auth application-default login
npm install
npm run dev:server
```

Sans émulateur explicitement configuré, cette commande utilise le **vrai projet
Firestore/bucket renseigné**. Il n'existe pas de repli JSON ou d'authentification
factice. Le prototype client reste utilisable séparément avec `npm run dev`.
`npm run dev:server` ne fournit pas le middleware Vite : compiler avec
`npm run build` pour servir le site depuis le backend.

Variables du backend :

| Variable | Valeur |
| --- | --- |
| `GCP_PROJECT_ID` | ID du projet |
| `GOOGLE_CLIENT_ID` | Client ID OAuth **Web** |
| `GCS_BUCKET` | Nom du bucket, sans `gs://` |
| `ALLOWED_ORIGINS` | Origines exactes autorisées, séparées par des virgules |
| `GEMINI_API_KEY` | Secret facultatif de secours, jamais `VITE_…` |
| `PORT` | Injecté par Cloud Run ; 8080 en local par défaut |

### Clés Gemini personnelles

La configuration utilisateur est stockée dans Firestore, document
`users/{googleSub}/settings/ai`, accessible uniquement via l'API authentifiée
et son compte de service. Les règles Firestore doivent continuer à refuser
tout accès direct des clients. Le chiffrement au repos est celui de Firestore ;
la clé n'est pas chiffrée séparément par l'application et reste lisible par les
administrateurs autorisés du backend. Ne pas exporter ces documents avec les thèmes
ni journaliser les corps de requêtes de configuration.

`GET /api/settings/gemini` renvoie seulement les indicateurs `configured` et
`serverAvailable`. `PUT` reçoit `{ "apiKey": "..." }` (remplacement) ou
`{ "apiKey": null }` (suppression). Toutes les réponses sont `no-store`.
Le serveur choisit la clé du compte authentifié pour le scan de photo et la
recherche de connecteurs, puis `GEMINI_API_KEY` uniquement en son absence.
Une clé personnelle invalide ne bascule pas silencieusement sur la clé serveur.
Déployer cette version du backend avant de distribuer le Web ou l'APK actualisé.

Pour redéployer les changements depuis le Mac, à la racine de
`VSC_AnalogSynth` :

```sh
gcloud run deploy analog-memory \
  --source . \
  --project gen-lang-client-0885269358 \
  --region us-central1 \
  --service-account analog-memory-runtime@gen-lang-client-0885269358.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --max-instances 1 \
  --memory 512Mi \
  --concurrency 10 \
  --set-env-vars '^@^GCP_PROJECT_ID=gen-lang-client-0885269358@GOOGLE_CLIENT_ID=65609223509-pnajgji06fkf09c29ncll5tafkmjtbio.apps.googleusercontent.com@GCS_BUCKET=gen-lang-client-0885269358-analog-media@ALLOWED_ORIGINS=http://localhost:5173,https://localhost,https://analog-memory-65609223509.us-central1.run.app,https://analog-memory-deg3jpygqq-uc.a.run.app'
```

`--allow-unauthenticated` permet de charger la page publique de connexion.
**Les routes de données et IA restent protégées par l'application.**
Ne pas confondre un ID token Google Sign-In avec un jeton IAM Cloud Run.

Après obtention de l'URL Cloud Run :

1. Ajouter son origine au client OAuth Web.
2. Ajouter cette origine à `ALLOWED_ORIGINS`, en conservant les origines voulues.
   `https://localhost` est l'origine habituelle de la WebView Capacitor Android.
3. L'ID OAuth Web public est défini via `VITE_GOOGLE_CLIENT_ID` ou le fallback
   propre au projet. `VITE_API_URL` reste vide par défaut sur le web (API même
   origine) et l'APK pointe sur Cloud Run. `VITE_AI_SERVER_URL` est facultatif.
4. En développement local, démarrer le backend sur le port 8080 (`gcloud auth
   application-default login`, puis `npm run dev:server`) et Vite sur 5173 ; le
   proxy Vite transmet les routes applicatives au backend.
5. Après création du client OAuth Android, reconstruire l'APK avec
   `npm run build && npm run cap:sync && ./android/gradlew -p android assembleDebug`.

### Erreur « Origine non autorisée » sur le site cloud

Le contrôle d'origine s'applique aussi aux requêtes du site vers sa propre API.
Un chargement de page ou une lecture GET peut fonctionner alors que l'ajout
d'une façade, l'envoi de sa photo ou l'analyse IA échoue : les requêtes POST/PUT
du navigateur transmettent l'en-tête `Origin`.

Autoriser chacune des URL Cloud Run utilisées pour ouvrir le site (URL avec le
numéro de projet et URL avec l'identifiant du service), ainsi que les éventuels
domaines personnalisés. Pour le service actuel, la correction suivante conserve
les origines locales et ne modifie pas les autres variables ni les secrets :

```sh
gcloud run services update analog-memory \
  --project gen-lang-client-0885269358 \
  --region us-central1 \
  --update-env-vars '^@^ALLOWED_ORIGINS=http://localhost:5173,https://localhost,https://analog-memory-65609223509.us-central1.run.app,https://analog-memory-deg3jpygqq-uc.a.run.app'
```

Si d'autres origines ont été ajoutées au service, les conserver dans cette liste.
Les origines doivent être exactes, sans chemin ni barre oblique finale. Ne pas
désactiver le contrôle d'origine et ne pas utiliser de joker `*`.

Si Gemini est souhaité, créer la clé dans Google AI Studio liée à ce projet, la
restreindre à Generative Language API et enregistrer sa valeur via **Secret
Manager**, sans la coller dans une commande ou un fichier versionné. Une fois
le rôle d'accès au secret accordé au compte runtime :

```sh
gcloud run services update analog-memory \
  --project gen-lang-client-0885269358 \
  --region us-central1 \
  --update-secrets GEMINI_API_KEY=analog-memory-gemini:1
```

La révision déployée utilise la version **1** du secret. Lors d'une rotation,
remplacer ce numéro par celui de la nouvelle version active puis exécuter à
nouveau la commande. `--update-secrets` conserve les autres secrets du service.

Sans cette clé, les endpoints IA retournent 503. Ils sont limités à 10 requêtes
par minute et par compte **par instance** ; ne pas augmenter le nombre
d'instances sans prévoir une limite distribuée. Configurer aussi quotas Gemini,
limites Cloud Run et alertes budgétaires. Une alerte budgétaire n'est pas un
plafond de dépenses.

## 6. API applicative préparée

Toutes les routes, sauf `/api/health`, nécessitent le jeton Google.

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET | `/api/health` | Vérifie que le processus répond, pas les permissions cloud |
| GET | `/api/auth/me` | Identité Google vérifiée |
| GET | `/api/sets` | Liste fusionnée des 100 SETS les plus récents |
| POST | `/api/sets` | Crée un SET avec PATCHES, `revision: 0` |
| GET | `/api/sets/:setId` | Charge le SET, ses PATCHES, modules et câbles |
| PUT | `/api/sets/:setId` | Sauvegarde complète avec la révision attendue |
| PUT | `/api/sets/:setId/media/:mediaId` | Ajoute un fichier privé immuable |
| GET | `/api/sets/:setId/media/:mediaId` | Télécharge un média nouveau ou historique |
| GET | `/api/themes` | Liste des 100 thèmes les plus récemment modifiés du compte |
| POST | `/api/themes` | Crée un thème, `revision: 0` |
| GET | `/api/themes/:themeId` | Charge thème, façades et révision |
| PUT | `/api/themes/:themeId` | Sauvegarde complète avec la révision attendue |
| PUT | `/api/themes/:themeId/media/:mediaId` | Ajoute un fichier privé immuable |
| GET | `/api/themes/:themeId/media/:mediaId` | Télécharge le fichier après authentification |
| POST | `/api/rings/analyze` | Analyse une façade avec le relais existant |
| POST | `/api/rings/hidden-jacks` | Recherche ses connecteurs non visibles |

Écriture d'un SET (les routes `/api/themes` ci-dessus sont conservées pour compatibilité) :

```json
{ "workspace": { "version": 3, "set": {}, "patches": [], "activePatchId": "...", "module": {} }, "revision": 0 }
```

C'est une illustration de l'enveloppe, pas un payload valide : `set` contient
au minimum UUID, nom, BPM et tonalité ; `module` contient nom, fabricant,
les instances de modules et leur identifiant actif (vide si le PATCH actif est
vide). Un SET a au moins un PATCH, avec UUID, nom, notes et `moduleInstanceIds`.
Chaque instance doit appartenir à exactement un PATCH. Le contrat exact est validé par
[server/schema.ts](./server/schema.ts). La réponse contient
`workspace`, `revision` et `updatedAt`.

Upload : `Content-Type: application/octet-stream`, `X-Media-Type` avec le type
réel et corps binaire. Limites : photo 8 Mio, MIDI 10 Mio, autre média 25 Mio.
La structure des chunks MIDI est vérifiée ; cela n'interprète pas les événements
et ne garantit pas la validité musicale. Pour remplacer un fichier, utiliser un
nouvel UUID : un écrasement retourne 409.

Le thème doit exister avant l'upload. La sauvegarde documentaire et l'upload
d'un fichier ne constituent pas une transaction entre Firestore et Storage :
une référence peut être présente avant que son fichier ait été transféré.
Le futur client devra suivre les transferts en attente et les erreurs, sans
annoncer « synchronisé » avant leur achèvement.

La suppression distante, la pagination au-delà de 100 thèmes, la gestion des
transferts volumineux/reprenables et le nettoyage des médias devenus orphelins
ne sont pas encore exposés. Retirer une façade de l'état supprime son document,
pas les anciens fichiers du bucket. Aucun effacement cloud automatique n'est
déclenché par ce prototype local.

## 7. Connexion et création/ouverture de thèmes

Depuis le site Cloud Run, se connecter avec **Se connecter avec Google**.
Sélectionner un thème existant pour l'ouvrir ou créer le premier thème cloud.
L'application n'affiche l'éditeur qu'après ouverture/création réussie.
Les modifications textuelles sont automatiquement enregistrées dans Firestore ;
photos, sons et fichiers MIDI sont transmis à Cloud Storage avant confirmation
de la synchronisation. Les médias consultés sont chargés à la demande et gardés
uniquement en mémoire vive pendant la session.

L'ancienne copie locale n'est ni importée ni conservée. Les ID tokens restent
en mémoire, jamais dans IndexedDB ; il faut se reconnecter après rechargement ou
expiration du jeton. Une connexion Internet est obligatoire. Quitter ou
recharger la page pendant un enregistrement ou une synchronisation en cours
peut perdre les changements qui n'ont pas encore reçu de confirmation.

Un conflit **409** arrête la synchronisation pour éviter d'écraser les données :
rouvrir la dernière version cloud avant de continuer. Il n'y a pas encore de
fusion automatique, de synchronisation hors ligne, ni de suppression des médias
distants devenus inutilisés.

Une fois l'ID OAuth Android créé et l'APK recompilée, Android utilise le même
compte Google et retrouve les mêmes thèmes. Le SSO natif ne fonctionnera pas
avant la configuration du package/SHA-1 Android.

Le mobile restera orienté photos, son et réglages ; le web recevra l'éditeur
de patchs et l'organisation complète des thèmes.

## Validation locale

`npm run build` vérifie les types du client et du serveur puis construit les
deux bundles. `npm test` couvre notamment la suppression d'IndexedDB, les médias
cloud temporaires, les fichiers MIDI, l'authentification/validation HTTP et les
opérations transactionnelles avec services simulés. Le démarrage du bundle serveur, la page web et les
réponses 200/401 ont aussi été vérifiés localement, ainsi que l'affichage des
nouveaux champs sur une largeur mobile de 393 px.

Le 7 octobre 2026, les 51 tests ont réussi et les builds web/backend et Android
ont été validés. Après déploiement, la page web et `/api/health` répondent
HTTP 200 ; `/api/themes` sans connexion répond HTTP 401. Le bundle web contient
les nouvelles fonctions MIDI/MASTER CLOCK et le bouton Google s'affiche.
Le compte runtime et la référence au secret Gemini existants ont été conservés.

L'APK debug **1.2** (`versionCode 3`), configurée pour Cloud Run sans URL LAN,
a été installée en mise à jour sur le téléphone Android connecté, puis lancée
avec succès. La tâche VS Code **Build Android cloud debug APK** permet de la
reconstruire ; elle désactive l'override IA local et utilise l'API HTTPS.
Cette distribution directe n'est pas une publication Google Play.

Les tests API/Firestore/Storage utilisent des services simulés. La connexion
Google et la sauvegarde d'un thème avec un compte réel restent à vérifier
manuellement sur le web et Android ; les contrôles HTTP ne les remplacent pas.

Au moment de cette étape, `npm audit --omit=dev` signale encore deux alertes
modérées dans la chaîne transitive `gaxios` / `uuid` du SDK Cloud Storage,
malgré la mise à jour des SDK Firebase Admin et Google Auth. Aucun contournement
par forçage de versions majeures transitives n'a été appliqué.

## Références officielles

- [Déployer Cloud Run depuis les sources](https://cloud.google.com/run/docs/deploying-source-code)
- [Vérifier un ID token Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Localisations Firestore](https://cloud.google.com/firestore/native/docs/locations)
