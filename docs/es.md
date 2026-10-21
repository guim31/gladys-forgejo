# Forgejo / Gitea

[Forgejo](https://forgejo.org/) y [Gitea](https://about.gitea.com/) son forjas
de software libres y autoalojadas, con la misma API;
[Codeberg](https://codeberg.org/) funciona con Forgejo. Esta integración sigue
los repositorios que usted indique: cada uno se convierte en un dispositivo con
sus estrellas, sus incidencias y pull requests abiertas, su última versión y el
estado de la CI de su rama principal. Sus escenas pueden reaccionar a una
**nueva versión**, una **nueva incidencia**, una **nueva pull request** o una
CI que **empieza a fallar o vuelve a estar en verde**, y un widget del panel
muestra todos los repositorios de un vistazo.

Probada con instancias reales de Forgejo 11.0 y Gitea 1.27 (Docker, SQLite) y
la API pública de Codeberg; todavía no con una instancia real de Gladys: sus
comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-forgejo/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un Forgejo o un Gitea accesible desde la máquina de Gladys, o una forja
  pública como codeberg.org.
- Solo para los repositorios privados: un token de acceso de un usuario que
  pueda leerlos.

La integración solo lee: nunca escribe nada en la forja. En cada actualización
(cada 10 minutos por defecto) hace cinco solicitudes por repositorio: el
repositorio, sus cinco últimas versiones, incidencias y pull requests, y el
estado de la CI de su rama por defecto. En Codeberg, mantenga un intervalo de
10 minutos o más y una lista corta: es un servicio gratuito de una asociación,
y demasiadas solicitudes reciben la respuesta «HTTP 429».

## Primeros pasos

### 1. Crear un token de acceso (repositorios privados)

Los repositorios públicos no necesitan token. Para los privados, abra en la
forja **Configuración → Aplicaciones → Generar nuevo token**, dele un nombre y
los permisos de solo lectura **read:repository** y **read:issue**, y cópielo.
El token ve lo que ve su usuario: un usuario dedicado lo limita aún más.

### 2. Configurar la integración

En Gladys, abra **Integraciones → Forgejo / Gitea → Configuración** y rellene:

- **Dirección de la forja**: la dirección con la que abre la forja,
  `http://192.168.1.2:3000`, `https://git.example.com` o `codeberg.org` (HTTPS
  para un nombre sin puerto).
- **Token de acceso (opcional)**: el token del paso 1.
- **Repositorios que seguir**: `propietario/nombre` o enlaces copiados del
  navegador, separados por comas, 20 como máximo. Ejemplo:
  `forgejo/forgejo, yo/mi-app`.
- **Intervalo de actualización** e **Idioma de los nombres**.

Pulse **Probar la conexión**: la forja y su versión, y después cada repositorio
con sus estrellas y el estado de su CI, o el motivo por el que no se puede leer.

### 3. Añadir los dispositivos

En **Descubrimiento**, añada los repositorios que desee como dispositivos. Las
cifras llegan enseguida. Los disparadores de escena y el widget funcionan
incluso para un repositorio no añadido como dispositivo.

## Los dispositivos

Un dispositivo por repositorio, llamado `propietario/nombre`, identificado por
el número que la forja da al repositorio: renombrarlo o transferirlo conserva
el dispositivo (escriba el nuevo nombre en la configuración).

| Función                    | Tipo     | Valor                                                        |
| -------------------------- | -------- | ------------------------------------------------------------ |
| Estrellas                  | contador | estrellas del repositorio                                    |
| Forks                      | contador | forks                                                        |
| Incidencias abiertas       | contador | incidencias abiertas (sin las pull requests)                 |
| Pull requests abiertas     | contador | pull requests abiertas                                       |
| Última versión             | texto    | etiqueta de la última versión, si no de la última preliminar |
| Fecha de la última versión | texto    | su fecha de publicación                                      |
| Estado de la CI            | texto    | Correcta, Fallida, En curso o Sin CI                         |
| CI correcta                | binario  | 1 cuando la CI pasa, 0 cuando falla                          |

El estado de la CI es el estado combinado del último commit de la rama por
defecto: todas las comprobaciones publicadas en él, Forgejo Actions y Gitea
Actions incluidos, así como Woodpecker, Drone o Jenkins cuando informan a la
forja. Una «advertencia» cuenta como correcta. Mientras la CI se ejecuta,
**CI correcta** conserva su último valor.

## Panel

El widget **Repositorios** muestra una línea por repositorio: el estado de la
CI, la última versión y el número de incidencias abiertas, primero los
repositorios que fallan y luego los que están en curso. Elija repositorios en
sus ajustes, o déjelo vacío para todos. **Actualizar** vuelve a leer la forja
enseguida.

## Escenas

### Disparadores

- **Nueva versión publicada**: ha salido una versión o una versión preliminar
  (filtro por repositorio y tipo). Variables: el repositorio, el nombre de la
  versión, su etiqueta, su autor, su enlace y un resumen listo para un mensaje.
- **Nueva incidencia**: alguien ha abierto una incidencia. Variables: el
  repositorio, el número, el título, el autor, el enlace y un resumen.
- **Nueva pull request**: alguien ha abierto una pull request. Las mismas
  variables.
- **CI fallida o de nuevo en verde**: la CI de la rama por defecto empieza a
  fallar, o vuelve a pasar tras un fallo (filtro por estado). Variables: el
  repositorio, la rama, el commit, el enlace y un resumen.

La primera lectura de un repositorio solo aprende su estado: el pasado nunca se
anuncia. Los borradores nunca se anuncian. Se envían como máximo tres eventos
de un mismo tipo por repositorio y lectura (una ráfaga de incidencias
importadas no inunda las escenas). Lo visto lo conserva la integración: un
reinicio no pierde ningún evento ni lo anuncia dos veces.

### Acciones

- **Leer un repositorio**: las cifras de un repositorio seguido como variables
  para las siguientes acciones: estrellas, forks, incidencias y pull requests
  abiertas, última versión, estado de la CI, CI correcta.

### Ideas de escenas

- **Nueva versión publicada** de un proyecto que usted autoaloja → envíe un
  mensaje con su resumen: es hora de actualizar.
- **CI fallida o de nuevo en verde**, estado «fallida» → ponga la lámpara del
  despacho en rojo; estado «de nuevo en verde» → vuelva a ponerla en blanco.
- Cada lunes por la mañana → **Leer un repositorio** y envíese un mensaje con
  sus incidencias y pull requests abiertas.

## Solución de problemas

- **La forja no responde**: compruebe la dirección desde la máquina de Gladys
  (mismo puerto, mismo protocolo); un Gladys en Docker llega al host por su
  dirección IP, no por `localhost`.
- **La dirección redirige**: introduzca la dirección `https://` a la que llega
  el navegador.
- **Token de acceso rechazado**: el token se eliminó o se copió mal; cree uno
  nuevo.
- **Repositorio no encontrado, o privado sin un token que pueda leerlo**:
  compruebe `propietario/nombre` y los permisos del token (read:repository).
- **Repositorio renombrado o transferido**: escriba su nuevo nombre; el
  dispositivo se conserva.
- **Demasiadas solicitudes**: elija un intervalo más largo o siga menos
  repositorios.
- Los disparadores de incidencias y pull requests nunca se activan en un
  repositorio privado cuyas cifras son correctas: al token le falta
  **read:issue**.
- **Certificado rechazado**: no se acepta un certificado autofirmado; use la
  dirección `http://` en la red local.

## Límites

- Solo lectura: ningún comando, no se escribe nada en la forja.
- 20 repositorios como máximo, leídos como mucho cada 5 minutos: un evento
  llega hasta un intervalo más tarde.
- Solo la CI de la rama por defecto; un resultado de CI por commit (el estado
  combinado), no uno por workflow.
- Las incidencias y pull requests se detectan por su número: una eliminada y
  creada de nuevo no se ve dos veces.
- Los textos de los dispositivos y escenas siguen el idioma de la
  configuración; los nombres de las funciones se fijan al añadir un
  dispositivo.
- Desarrollada y probada con Forgejo 11.0 y Gitea 1.27; las versiones
  anteriores con la misma API v1 deberían funcionar, sin garantía.
