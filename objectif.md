je voudrais faire une application qui me permette basiquement de mémoriser la position des éléments de l'interface de mes synthétiseurs analogiques. Le problème est le suivant : j'ai plusieurs modules Eurorack qui sont tous analogiques. Donc aucune possibilité de mémoriser des presets. Donc mon idée est de prendre une photo de l'interface et demander à l'IA de scanner l'interface et mémoriser les différents paramètres : position des potentiomètres, des intérrupteurs, des LED, du cablage. 

On partirait d'un set de musique et chaque module Eurorack utilisé serait scanné et mémorisé. 

D'autre part je veux évidemment mémoriser le son émis par ce module. Peux tu me trouver une solution pour que je puisse brancher mon téléphone sur la sortie du module Eurorack et que le preset soit enregistrer avec une trace du son. 

L'application doit être faite pour mon téléphone android Xiaomi 15 Pro.

Il faut utiliser la même architecture que le projet /downloads/inventaire_IA : application de saisie via le téléphone, création d'une base de données sur google, interface web pour la gestion des sets et des enregistrements. 

Le set aura dans un premier temps juste un nom mais on peut imaginer ensuite plus de données, comme le BPM, la gamme. Une vue du set permettra de voir tous les modules utilisés et le patch appliqué. 

Peux-tu commencer par réaliser la partie "saisie de l'information" pour voir comme on peut gérer les données. Si cela est intéressant, on fera la version base de données externe / interface web.

Tu as sur le répertoire une image d'un module utilisé qui servira d'exemple. Il s'agit du RINGS de Mutable Instruments. Tu trouveras sur le net le mode d'emploi et une image propre que tu pourras utiliser pour dessiner l'interface. On pourrait penser à un style comme VCV rack2.

Le premier set s'appelera : "Thème 1", BPM= 90 en E majeur. 

Dis moi si cela te semble réalisable et si tu as des questions. 

tu as les données de rings ici : https://pichenettes.github.io/mutable-instruments-documentation/modules/rings/

