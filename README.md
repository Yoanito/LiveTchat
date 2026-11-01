# LiveTchat

Application Windows pour afficher une image ou une vidéo, avec ou sans texte, en overlay sur l'écran de ses amis. L'overlay ne se clique pas et ne prend pas le focus, pour ne pas gêner quelqu'un en pleine partie.

## Ce que fait l'appli

- **Salon** : l'un des amis clique sur « Héberger un salon ». Son PC devient le serveur, et l'appli lui donne une adresse du type `lt://1.2.3.4:41234/…` à envoyer aux autres, qui la collent dans « Rejoindre ».
- **Envoi** : on choisit une image ou une vidéo, un texte optionnel, et « Envoyer au salon ». Le média passe par le PC de l'hôte, chacun le télécharge puis l'affiche dès qu'il l'a reçu.
- **Mute par personne** : une case à cocher à côté de chaque membre. Le choix est mémorisé.
- **Affichage** : écran et zone au choix (plein écran ou rectangle dessiné à la souris), son, volume, opacité. Les médias arrivés en même temps passent l'un après l'autre.
- **Overlay** : fenêtre transparente, toujours au-dessus, traversée par les clics, qui ne prend jamais le focus et n'apparaît ni dans la barre des tâches ni dans Alt+Tab.

Formats acceptés : PNG, JPEG, WebP, GIF, MP4 (H.264), WebM. Vidéos coupées à 30 s.

## Héberger un salon depuis chez soi

Les amis doivent pouvoir joindre le PC de l'hôte à travers Internet :

1. **Automatique** : l'appli demande à la box d'ouvrir le port (UPnP). La plupart des box le permettent, parfois après avoir activé UPnP dans leur interface.
2. **Manuel** : si la box refuse, ouvre le port TCP indiqué (41234 par défaut) vers le PC de l'hôte dans l'interface de la box.
3. **Pare-feu Windows** : au premier « Héberger », Windows demande d'autoriser LiveTchat. Il faut accepter, sinon personne ne pourra se connecter.

Si l'appli indique que ton fournisseur partage ton adresse IP (CGNAT), tes amis ne pourront pas te joindre : un autre ami doit héberger.

L'adresse contient une clé secrète : seuls ceux qui ont l'adresse complète peuvent entrer. Ne la partage qu'avec tes amis.

Le salon n'existe que tant que l'appli de l'hôte est ouverte. Les fichiers reçus sont effacés au bout de 10 minutes.

## Lancer

Il faut [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install
npm start
```

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

Dans la première, héberge ; dans la seconde, rejoins avec l'adresse « réseau local ».

### Sur vos jeux

1. Règle l'écran et la zone, choisis une vidéo avec du son.
2. Dans « Tester seulement chez moi », mets un **délai** de 5 à 10 s, clique sur **Afficher chez moi**, puis retourne en jeu.
3. Pour chaque jeu, note :
   - l'overlay est-il visible en **fenêtré**, en **plein écran fenêtré / sans bordure**, en **plein écran** ?
   - le jeu garde-t-il le focus (clavier, souris, caméra) pendant l'affichage ?
   - le son passe-t-il ?
   - des saccades ou une baisse de FPS ?
4. Si un jeu a un anti-triche (Valorant, Fortnite, CS2…), vérifie qu'il ne se plaint pas.

Le plein écran exclusif n'est pas visé : il faut mettre les jeux en mode sans bordure.

## Réglages

Ils sont enregistrés dans `%APPDATA%\livetchat\settings.json`. La zone est stockée en pourcentages de l'écran, pour rester correcte si la résolution ou la mise à l'échelle change.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/main.js` | Processus principal : fenêtres, réglages, file d'attente, vérification des fichiers |
| `src/overlay.*` | Fenêtre overlay qui affiche le média et le texte |
| `src/zone.*` | Sélecteur de zone plein écran |
| `src/control.*` | Fenêtre de réglages, salon et envoi |
| `src/room/server.js` | Serveur du salon chez l'hôte (WebSocket pour la présence, HTTP pour les fichiers) |
| `src/room/client.js` | Connexion d'un membre, reconnexion automatique, envoi et téléchargement |
| `src/room/upnp.js` | Ouverture automatique du port sur la box |
| `src/room/address.js` | Format des adresses `lt://hôte:port/clé` |
| `src/preload-*.js` | Ponts sécurisés entre les pages et le processus principal |

Les pages tournent isolées (`contextIsolation`, `sandbox`, pas d'accès à Node). Le texte reçu est toujours affiché en texte brut, jamais interprété comme du HTML.

## Prochaines étapes

- Touche panique (raccourci global pour couper l'affichage).
- Retours de vos tests sur les jeux et sur les box de chacun.
