/**
 * utils/startup.ts
 * Module d'affichage au démarrage avec cli-progress pour une barre professionnelle
 */

import { botIdentity } from './botIdentity.js';
import { SingleBar, Presets } from 'cli-progress';

/**
 * En mode TUI (ink-cli), Ink contrôle stdout pour dessiner son interface.
 * Tout `console.log` du core ou des plugins vient écraser l'écran Ink → corruption d'affichage.
 * On redirige alors console.log/warn/info vers un buffer au lieu de stdout.
 * Ces logs restent accessibles via HIVE_DEBUG=1 pour diagnostic.
 */
function isTuiMode(): boolean {
  const transports = (process.env.ACTIVE_TRANSPORTS || '').split(',').map((s) => s.trim());
  return transports.includes('ink-cli') || transports.includes('tui');
}

function isDebugMode(): boolean {
  return process.env.HIVE_DEBUG === '1' || process.env.DEBUG === 'true';
}

/**
 * Thème de couleurs pour la console
 */
const THEME = {
  PRIMARY: '\x1b[34m', // Blue
  ACCENT: '\x1b[94m', // Bright Blue
  CYAN: '\x1b[36m', // Cyan
  SHADOW: '\x1b[90m', // Dark Gray (shadow)
  SECONDARY: '\x1b[33m', // Yellow
  SUCCESS: '\x1b[32m', // Green
  ERROR: '\x1b[31m', // Red
  GRAY: '\x1b[90m', // Gray
  RESET: '\x1b[0m', // Reset
} as const;

export interface StartupModule {
  id: string;
  name: string;
  icon: string;
}

export interface ModuleResult {
  status: 'success' | 'error';
  module: StartupModule;
  detail?: string;
  error?: string;
}

/**
 * Génère le logo ASCII HIVE-MIND avec effet 3D
 */
function generateLogo(botName: string): string {
  const displayName = `🧠 ${botName} AI - v1.0`;

  const logo3D = [
    `${THEME.ACCENT} ██╗  ██╗${THEME.CYAN}██╗${THEME.ACCENT}██╗   ██╗${THEME.CYAN}███████╗${THEME.SHADOW}      ${THEME.ACCENT}███╗   ███╗${THEME.CYAN}██╗${THEME.ACCENT}███╗   ██╗${THEME.CYAN}██████╗ `,
    `${THEME.ACCENT} ██║  ██║${THEME.CYAN}██║${THEME.ACCENT}██║   ██║${THEME.CYAN}██╔════╝${THEME.SHADOW}      ${THEME.ACCENT}████╗ ████║${THEME.CYAN}██║${THEME.ACCENT}████╗  ██║${THEME.CYAN}██╔══██╗`,
    `${THEME.ACCENT} ███████║${THEME.CYAN}██║${THEME.ACCENT}██║   ██║${THEME.CYAN}█████╗${THEME.SHADOW}  █████╗${THEME.ACCENT}██╔████╔██║${THEME.CYAN}██║${THEME.ACCENT}██╔██╗ ██║${THEME.CYAN}██║  ██║`,
    `${THEME.ACCENT} ██╔══██║${THEME.CYAN}██║${THEME.ACCENT}╚██╗ ██╔╝${THEME.CYAN}██╔══╝${THEME.SHADOW}  ╚════╝${THEME.ACCENT}██║╚██╔╝██║${THEME.CYAN}██║${THEME.ACCENT}██║╚██╗██║${THEME.CYAN}██║  ██║`,
    `${THEME.ACCENT} ██║  ██║${THEME.CYAN}██║${THEME.ACCENT} ╚████╔╝ ${THEME.CYAN}███████╗${THEME.SHADOW}      ${THEME.ACCENT}██║ ╚═╝ ██║${THEME.CYAN}██║${THEME.ACCENT}██║ ╚████║${THEME.CYAN}██████╔╝`,
    `${THEME.SHADOW} ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝      ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝ `,
  ];

  let output = `\n${THEME.PRIMARY}╔═══════════════════════════════════════════════════════════════════════╗${THEME.RESET}\n`;
  output += `${THEME.PRIMARY}║                                                                       ║${THEME.RESET}\n`;

  logo3D.forEach((line: string) => {
    output += `${THEME.PRIMARY}║ ${line}${THEME.PRIMARY}║${THEME.RESET}\n`;
  });

  output += `${THEME.PRIMARY}║                                                                       ║${THEME.RESET}\n`;
  output += `${THEME.PRIMARY}║                    ${THEME.SECONDARY}${displayName.padEnd(40)}${THEME.PRIMARY}      ║${THEME.RESET}\n`;
  output += `${THEME.PRIMARY}╚═══════════════════════════════════════════════════════════════════════╝${THEME.RESET}\n`;

  return output;
}

const DEFAULT_MODULES: StartupModule[] = [
  { id: 'config', name: 'Configuration', icon: '⚙️' },
  { id: 'redis', name: 'Redis Cloud', icon: '🔴' },
  { id: 'supabase', name: 'Supabase DB', icon: '🗄️' },
  { id: 'plugins', name: 'Plugins', icon: '🔌' },
  { id: 'scheduler', name: 'Scheduler', icon: '⏰' },
  { id: 'admin', name: 'Admin Service', icon: '👑' },
  { id: 'transport', name: 'WhatsApp Transport', icon: '📱' },
];

export class StartupDisplay {
  private results = new Map<string, ModuleResult>();
  private errors: { module: string; error: string }[] = [];
  private startTime: number = Date.now();
  private modules: StartupModule[] = DEFAULT_MODULES;
  private totalSteps: number = DEFAULT_MODULES.length;
  private currentStep: number = 0;
  private progressBar: SingleBar | null = null;
  private isDebug: boolean = process.env.DEBUG === 'true';

  private get isTest(): boolean {
    return process.env.APP_ENV === 'test' || process.env.NODE_ENV === 'test';
  }

  private get isTuiSuppressed(): boolean {
    return isTuiMode() && !isDebugMode() && !this.isTest;
  }

  private originalConsole = {
    log: console.log,
    warn: console.warn,
    info: console.info,
  };
  private suppressedLogs: { type: 'log' | 'warn' | 'info'; args: unknown[] }[] = [];
  private isLoading: boolean = false;

  constructor() {}

  private logRedirector(type: 'log' | 'warn' | 'info'): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      if (this.isLoading && !this.isDebug) {
        this.suppressedLogs.push({ type, args });
      } else {
        const fn = Reflect.get(this.originalConsole, type) as (...a: unknown[]) => void;
        fn(...args);
      }
    };
  }

  public suppressLogs(): void {
    if (this.isTest) return;
    this.isLoading = true;
    console.log = this.logRedirector('log');
    console.warn = this.logRedirector('warn');
    console.info = this.logRedirector('info');
  }

  public restoreLogs(): void {
    this.isLoading = false;
    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.info = this.originalConsole.info;
    this.suppressedLogs = [];
  }

  public setModules(modulesList: StartupModule[]): void {
    if (Array.isArray(modulesList)) {
      this.modules = modulesList;
      this.totalSteps = this.modules.length;
    }
  }

  public showLogo(): void {
    if (this.isTest) {
      this.originalConsole.log(
        `\n🧠 Initialisation de ${botIdentity.fullName} (Mode Test non-interactif)...\n`,
      );
      return;
    }
    if (this.isTuiSuppressed) {
      // En mode TUI, on évite tout ce qui écrirait sur stdout : pas de logo, pas
      // de barre de progression, pas de redéfinition de console. Ink contrôle déjà
      // stdout pour dessiner l'interface.
      return;
    }
    this.suppressLogs();
    if (!this.isDebug) {
      this.originalConsole.log('\x1bc');
    } else {
      this.originalConsole.log('\n--- Démarrage du système ---\n');
    }

    const logo = generateLogo(botIdentity.fullName);
    this.originalConsole.log(logo);

    this.progressBar = new SingleBar(
      {
        format: `  ${THEME.PRIMARY}║${THEME.ACCENT} {bar} ${THEME.PRIMARY}║${THEME.RESET} ${THEME.CYAN}{percentage}%${THEME.RESET} │ {module}`,
        barCompleteChar: '▓',
        barIncompleteChar: '░',
        barsize: 30,
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
      },
      Presets.shades_classic,
    );

    this.progressBar.start(this.totalSteps, 0, {
      module: `${THEME.GRAY}Initialisation...${THEME.RESET}`,
    });
  }

  public loading(moduleId: string): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (!module) return;
    if (this.isTest) {
      this.originalConsole.log(`  [Chargement] ${module.icon} ${module.name}...`);
      return;
    }
    if (this.isTuiSuppressed) {
      // En TUI, on garde la progression en mémoire pour usage futur (panel de
      // démarrage dans l'UI Ink) mais on n'écrit rien.
      this.currentStep = Math.max(this.currentStep, this.modules.indexOf(module));
      return;
    }
    if (this.progressBar) {
      const label = `${module.icon} ${module.name}...`;
      this.progressBar.update(this.currentStep, { module: label });
    }
  }

  public success(moduleId: string, detail = ''): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (module) {
      this.currentStep++;
      const statusText = detail
        ? `${module.icon} ${module.name} (${detail})`
        : `${module.icon} ${module.name}`;
      this.results.set(moduleId, { status: 'success', module, detail });

      if (this.isTest) {
        this.originalConsole.log(`  [Succès] ✓ ${statusText}`);
        return;
      }
      if (this.isTuiSuppressed) {
        return;
      }
      if (this.progressBar) {
        this.progressBar.update(this.currentStep, { module: `\x1b[32m✓\x1b[0m ${statusText}` });
      }
    }
  }

  public error(moduleId: string, errorMsg: string): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (module) {
      this.currentStep++;
      this.results.set(moduleId, { status: 'error', module, error: errorMsg });
      this.errors.push({ module: module.name, error: errorMsg });

      if (this.isTest) {
        this.originalConsole.log(`  [Erreur] ✗ ${module.icon} ${module.name}: ${errorMsg}`);
        return;
      }
      if (this.isTuiSuppressed) {
        return;
      }
      if (this.progressBar) {
        this.progressBar.update(this.currentStep, {
          module: `\x1b[31m✗\x1b[0m ${module.icon} ${module.name}`,
        });
      }
    }
  }

  private stopProgressBar(): string {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    if (this.isTest) {
      this.originalConsole.log(
        `\n  ✓ Démarrage de ${botIdentity.fullName} terminé en ${elapsed}s!\n`,
      );
      return elapsed;
    }
    if (this.isTuiSuppressed) {
      // On garde en mémoire la progression pour usage TUI éventuel mais on ne touche pas à stdout.
      return elapsed;
    }
    if (this.progressBar) {
      this.progressBar.update(this.totalSteps, {
        module: `${THEME.SUCCESS}✓ Démarrage terminé!${THEME.RESET}`,
      });
      this.progressBar.stop();
    }
    this.restoreLogs();
    console.log('\n');
    return elapsed;
  }

  private printModuleResults(): void {
    if (this.isTuiSuppressed) return;
    for (const module of this.modules) {
      const result = this.results.get(module.id);
      if (!result) continue;

      if (result.status === 'success') {
        const detail = result.detail ? ` ${THEME.GRAY}(${result.detail})${THEME.RESET}` : '';
        console.log(`  ${THEME.SUCCESS}✓${THEME.RESET} ${module.icon} ${module.name}${detail}`);
      } else {
        console.log(
          `  ${THEME.ERROR}✗${THEME.RESET} ${module.icon} ${module.name} ${THEME.ERROR}- ${result.error}${THEME.RESET}`,
        );
      }
    }
    console.log('');
  }

  private printSummaryFrame(botName: string, elapsed: string): void {
    if (this.isTuiSuppressed) return;
    const border = this.errors.length === 0 ? THEME.SUCCESS : THEME.SECONDARY;
    console.log(`${border}╔════════════════════════════════════════════╗${THEME.RESET}`);
    if (this.errors.length === 0) {
      console.log(
        `${border}║  ✅ ${botName.substring(0, 20).padEnd(20)} prêt !         ║${THEME.RESET}`,
      );
      console.log(
        `${border}║  ⏱️  Démarrage en ${elapsed.padStart(5)}s                   ║${THEME.RESET}`,
      );
    } else {
      console.log(
        `${border}║  ⚠️  ${botName.substring(0, 15).padEnd(15)} : ${this.errors.length} erreur(s)  ║${THEME.RESET}`,
      );
    }
    console.log(`${border}╚════════════════════════════════════════════╝${THEME.RESET}`);
  }

  private printErrorDetails(): void {
    if (this.isTuiSuppressed) return;
    if (this.errors.length > 0) {
      console.log(`\n${THEME.ERROR}Détails des erreurs:${THEME.RESET}`);
      for (const err of this.errors) {
        console.log(`  • ${err.module}: ${err.error}`);
      }
    }
    console.log(`\n${THEME.SUCCESS}✅ Système actif et connecté !${THEME.RESET}\n`);
  }

  public complete(botName = 'Bot'): void {
    const elapsed = this.stopProgressBar();
    this.printModuleResults();
    this.printSummaryFrame(botName, elapsed);
    this.printErrorDetails();
  }
}

export const startupDisplay = new StartupDisplay();
export default startupDisplay;
