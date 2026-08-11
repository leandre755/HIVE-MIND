/**
 * Résolution du binaire ffmpeg pour tous les convertisseurs audio.
 *
 * `@ffmpeg-installer/ffmpeg` fournit un binaire embarqué : sans cet
 * enregistrement, `fluent-ffmpeg` cherche `ffmpeg` dans le `PATH` et échoue sur
 * un hôte qui n'en dispose pas. Les adapters TTS dupliquaient chacun cet
 * appel ; il est centralisé ici pour qu'un seul chemin fasse foi.
 *
 * L'appel passe par une instance (`ffmpeg().setFfmpegPath`) et non par le
 * raccourci statique `ffmpeg.setFfmpegPath` : ce dernier est lu par
 * `import-x/no-named-as-default-member` comme un membre du module CommonJS,
 * alors que l'import nommé qu'il suggère (`import { setFfmpegPath }`) est
 * rejeté par Node à l'exécution — `fluent-ffmpeg` n'expose aucun export
 * nommé ESM. La forme statique se contente d'ailleurs de déléguer à
 * l'instance (`lib/fluent-ffmpeg.js`), et le chemin est stocké dans le cache
 * de module partagé par toutes les instances (`lib/capabilities.js`) : la
 * portée de l'enregistrement reste globale au processus.
 */
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

let registered = false;

/**
 * Enregistre le binaire ffmpeg embarqué auprès de `fluent-ffmpeg`.
 *
 * INVARIANT : après un appel, toute instance `ffmpeg()` du processus résout le
 * binaire fourni par `@ffmpeg-installer/ffmpeg`.
 * Idempotent : les appels suivants ne refont pas l'enregistrement.
 */
export function ensureFfmpegBinary(): void {
  if (registered) return;
  ffmpeg().setFfmpegPath(ffmpegInstaller.path);
  registered = true;
}
