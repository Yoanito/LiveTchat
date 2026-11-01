# LiveTchat

Application Windows pour afficher une image ou une vidéo, avec ou sans texte, en overlay sur l'écran de ses amis. L'overlay ne se clique pas et ne prend pas le focus, pour ne pas gêner quelqu'un en pleine partie.

## État actuel : prototype de l'overlay

Ce premier prototype fonctionne **en local, sans réseau**. Il sert à vérifier la seule vraie inconnue du projet : que l'overlay s'affiche bien par-dessus vos jeux.

Ce qu'il fait :
- choix de l'écran et de la zone d'affichage (plein écran ou rectangle dessiné à la souris) ;
- son on/off, volume, opacité, taille maximale des fichiers ;
- affichage d'une image (durée réglable) ou d'une vidéo (30 s max), avec un texte optionnel ;
- file d'attente si plusieurs médias arrivent ;
- fenêtre transparente, toujours au-dessus, traversée par les clics, qui ne prend jamais le focus et n'apparaît ni dans la barre des tâches ni dans Alt+Tab.

Formats acceptés : PNG, JPEG, WebP, GIF, MP4 (H.264), WebM.

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

## Tester sur vos jeux

1. Règle l'écran et la zone, choisis une vidéo avec du son.
2. Mets un **délai** de 5 à 10 s, clique sur **Afficher**, puis retourne en jeu.
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
| `src/control.*` | Fenêtre de réglages et de test |
| `src/preload-*.js` | Ponts sécurisés entre les pages et le processus principal |

Les pages tournent isolées (`contextIsolation`, `sandbox`, pas d'accès à Node). Le texte reçu est toujours affiché en texte brut, jamais interprété comme du HTML.

## Prochaines étapes

- Salon hébergé par l'un des amis directement depuis l'appli (serveur intégré).
- Ouverture automatique du port sur la box de l'hôte (UPnP), avec repli manuel.
- Envoi des médias aux membres du salon, mute par personne.
