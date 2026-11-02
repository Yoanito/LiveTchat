# LiveTchat

Application Windows pour afficher une image ou une vidéo, avec ou sans texte, en overlay sur l'écran de ses amis. L'overlay ne se clique pas et ne prend pas le focus, pour ne pas gêner quelqu'un en pleine partie.

## Ce que fait l'appli

- **Salon** : l'un des amis clique sur « Créer un salon » et obtient un code du type `k7p2-x9qd-4mzt-wb3h`. Les autres l'entrent dans « Rejoindre ». Il n'y a pas d'hôte : le salon existe tant qu'au moins une personne y est.
- **Envoi** : on choisit une image ou une vidéo, un texte optionnel, la durée d'affichage (1 à 30 s, pour une image comme pour une vidéo : une vidéo plus longue est coupée), et « Envoyer au salon ». Choisir une vidéo remplit la durée avec sa longueur, qu'on peut raccourcir. Le fichier part directement de ton PC vers celui de chaque ami, qui l'affiche dès qu'il l'a reçu. La progression s'affiche, puis qui l'a reçu et qui ne l'a pas reçu.
- **Mute par personne** : une case à cocher à côté de chaque membre. Le choix est mémorisé, et les médias de cette personne ne sont même plus téléchargés.
- **Affichage** : écran et zone au choix (plein écran ou rectangle dessiné à la souris), son, volume, opacité. Les médias arrivés en même temps passent l'un après l'autre, 10 au maximum en attente.
- **Overlay** : fenêtre transparente, toujours au-dessus, traversée par les clics, qui ne prend jamais le focus et n'apparaît ni dans la barre des tâches ni dans Alt+Tab.

Formats acceptés : PNG, JPEG, WebP, GIF, MP4 (H.264), WebM. Limites, pour ne pas surcharger le PC de quelqu'un en pleine partie :

- 100 Mo par fichier ;
- images de 40 mégapixels au plus (une petite image PNG peut cacher des dimensions énormes, qui prendraient des centaines de Mo de RAM une fois affichées) ;
- vidéos en 4K (3840 × 2160) au plus, affichées 30 s au maximum.

L'appli vérifie le fichier dès qu'on le choisit, et l'overlay revérifie avant d'afficher.

## Comment les PC se connectent

Aucun port à ouvrir, aucun serveur à installer :

1. Pour se trouver, les PC passent par des **relais publics Nostr** (des serveurs gratuits ouverts à tous). Ils n'y échangent que de quoi établir la connexion, chiffré avec le code du salon.
2. Ensuite, chaque PC se connecte **directement** aux autres (WebRTC, la technique des appels vidéo dans le navigateur). Les médias ne passent par aucun serveur.

Le code du salon sert de clé : seuls ceux qui l'ont peuvent entrer. Ne le partage qu'avec tes amis.

Limite : avec certaines box ou certains réseaux (4G, réseaux d'entreprise ou d'école), la connexion directe peut échouer entre deux personnes. L'appli l'indique sous la liste des membres.

Chacun règle la taille max des médias qu'il accepte (100 Mo au plus). Si un fichier est trop lourd pour un ami, il ne le reçoit pas et l'envoyeur est prévenu. Les fichiers reçus sont effacés dès qu'ils ont été affichés, et ce qui reste après un plantage est effacé au lancement suivant.

## Lancer

Il faut [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install
npm start
```

`npm start` prépare d'abord le code réseau (`src/net/peer.bundle.js`) avec esbuild.

Pour fabriquer un `.exe` portable à envoyer aux amis :

```bash
npm run dist
```

L'exécutable est créé dans `dist/`. Windows SmartScreen affichera un avertissement au premier lancement (« Informations complémentaires » puis « Exécuter quand même »).

## Tester

Pour tester un salon seul, sur un seul PC, lance deux instances avec des profils différents, chacune dans son terminal.

Dans l'invite de commandes (cmd) :

```bat
set LIVETCHAT_PROFILE=a&& npm start
set LIVETCHAT_PROFILE=b&& npm start
```

Dans PowerShell :

```powershell
$env:LIVETCHAT_PROFILE="a"; npm start
$env:LIVETCHAT_PROFILE="b"; npm start
```

Dans la première, crée un salon ; dans la seconde, rejoins-le avec le code.

### Vérifier le code

```bash
npm run lint
npm test
```

`npm run lint` passe ESLint sur tout le code, `npm test` lance les tests des fonctions du processus principal (zone, code de salon, vérification des fichiers, réglages).

### Sur vos jeux

1. Règle l'écran et la zone, choisis une vidéo avec du son.
2. Dans « Tester seulement chez moi », mets un **délai** de 5 à 10 s, clique sur **Afficher chez moi**, puis retourne en jeu.
3. Pour chaque jeu, note :
   - l'overlay est-il visible en **fenêtré**, en **plein écran fenêtré / sans bordure**, en **plein écran** ?
   - le jeu garde-t-il le focus (clavier, souris, caméra) pendant l'affichage ?
   - le son passe-t-il ?
   - des saccades ou une baisse de FPS ?
   - dans le Gestionnaire des tâches, combien LiveTchat prend de GPU pendant une vidéo en plein écran ? Si c'est beaucoup, il faudra réduire la fenêtre overlay à la taille réelle du média.
4. Si un jeu a un anti-triche (Valorant, Fortnite, CS2…), vérifie qu'il ne se plaint pas.

Le plein écran exclusif n'est pas visé : il faut mettre les jeux en mode sans bordure.

## Réglages

Ils sont enregistrés dans `%APPDATA%\livetchat\settings.json`, 300 ms après le dernier changement, en passant par un fichier temporaire pour qu'un plantage ne le laisse jamais à moitié écrit. La zone est stockée en pourcentages de l'écran, pour rester correcte si la résolution ou la mise à l'échelle change.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/main.js` | Processus principal : démarrage, fenêtre de réglages et ses messages |
| `src/main/settings.js` | Lecture et écriture des réglages |
| `src/main/player.js` | Fenêtre overlay et file d'attente, avec redémarrage automatique si l'overlay plante ou se bloque |
| `src/main/room.js` | Salon : fenêtre réseau, membres, envoi et réception, fichiers reçus |
| `src/main/zone-picker.js` | Fenêtre du sélecteur de zone |
| `src/main/displays.js`, `files.js`, `room-code.js`, `util.js` | Écrans, vérification des fichiers, codes de salon, petites fonctions |
| `src/protocol.js` | Limites et constantes partagées |
| `src/overlay.*` | Fenêtre overlay qui affiche le média et le texte |
| `src/zone.*` | Sélecteur de zone plein écran |
| `src/control.*` | Fenêtre de réglages, salon et envoi |
| `src/net/peer.js` | Connexion directe entre les membres (trystero : WebRTC + relais Nostr), dans une fenêtre invisible, rechargée toute seule si elle plante |
| `src/preload-*.js` | Ponts sécurisés entre les pages et le processus principal |
| `test/` | Tests (`npm test`) |

Les pages tournent isolées (`contextIsolation`, `sandbox`, pas d'accès à Node). Le texte reçu est toujours affiché en texte brut, jamais interprété comme du HTML.

## Prochaines étapes

- Touche panique (raccourci global pour couper l'affichage).
- Retours de vos tests entre amis, chacun chez soi.
