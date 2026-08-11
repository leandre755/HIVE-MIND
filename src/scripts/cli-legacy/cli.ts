import readline from 'readline';
import { execFile } from 'child_process';
import { supabase } from '../../services/supabase.js';

/**
 * Terminal Interface Implementation
 * Handles local commands during bot execution
 */
class CliInterface {
  rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'BOT> ',
    });

    this.rl.on('line', (line: string) => {
      this.handleCommand(line.trim()).catch((err) => {
        console.error('[CLI] Command execution error:', err);
      });
    });

    console.log('[CLI] Terminal interface ready. Type "help" for commands.');
    this.rl.prompt();
  }

  async handleCommand(cmd: string) {
    if (!cmd) {
      this.rl.prompt();
      return;
    }

    const [command, ...args] = cmd.split(' ');
    await this.dispatchCommand(command.toLowerCase(), args);
    this.rl.prompt();
  }

  private async dispatchCommand(command: string, args: string[]) {
    if (command === 'help') {
      this.showHelp();
    } else if (command === 'exit') {
      console.log('Shutting down...');
      process.exit(0);
    } else if (command === 'doc') {
      await this.handleDocCommand(args);
    } else {
      console.log(`Unknown command: ${command}`);
    }
  }

  private showHelp() {
    console.log(`
📚 Available Commands:
  doc ingest   - Run document ingestion script
  doc clear    - Clear "global" knowledge base
  doc status   - Check knowledge base stats
  exit         - Stop the bot
        `);
  }

  async handleDocCommand(args: string[]) {
    const subCmd = args[0]?.toLowerCase();

    if (subCmd === 'ingest') {
      this.ingestDocs();
    } else if (subCmd === 'clear') {
      await this.clearDocs();
    } else if (subCmd === 'status') {
      await this.statusDocs();
    } else {
      console.log('Unknown doc subcommand. Try: ingest, clear, status');
    }
  }

  private ingestDocs() {
    console.log('⚙️ Starting ingestion script...');
    execFile(process.execPath, ['scripts/ingest_docs.js'], (error, stdout) => {
      if (error) console.error(`[Ingest Error] ${error.message}`);
      if (stdout) console.log(stdout);
      console.log('✅ Ingestion process finished.');
      this.rl.prompt();
    });
  }

  private async clearDocs() {
    if (!supabase) {
      console.error('❌ Supabase not connected.');
      return;
    }
    console.log('🗑️ Clearing global knowledge base...');
    const { error, count } = await supabase
      .from('memories')
      .delete({ count: 'exact' })
      .eq('chat_id', 'global');

    if (error) console.error(`❌ Error: ${error.message}`);
    else console.log(`✅ Cleared ${count} items.`);
  }

  private async statusDocs() {
    if (!supabase) {
      console.error('❌ Supabase not connected.');
      return;
    }
    const { error, count } = await supabase
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', 'global');

    if (error) console.error(`❌ Error: ${error.message}`);
    else console.log(`📚 Knowledge Base Status: ${count} documents (chunks).`);
  }
}

export const cli = new CliInterface();
