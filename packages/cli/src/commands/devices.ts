// =====================================================
// CLI Commands - Devices Command
// =====================================================

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import qrcode from 'qrcode-terminal';
import { ConfigStore } from '../core/config-store';
import { ApiClient } from '../core/api-client';
import { Logger } from '../utils/logger';

export const DevicesCommand = new Command('devices')
  .name('devices')
  .description('Manage paired devices')
  .addCommand(ListDevicesCommand)
  .addCommand(PairDeviceCommand)
  .addCommand(UnpairDeviceCommand);

const ListDevicesCommand = new Command('list')
  .name('list')
  .description('List paired devices')
  .action(async () => {
    const config = await ConfigStore.load();
    const api = new ApiClient();

    try {
      if (!config.isAuthenticated()) {
        console.log(chalk.yellow('Not logged in'));
        return;
      }

      console.log(chalk.bold('\nPaired Devices:\n'));
      const devices = await api.getDevices();

      if (devices.length === 0) {
        console.log(chalk.gray('  No devices paired'));
        console.log(chalk.gray('  Run "agentapprove devices pair" to pair a device\n'));
        return;
      }

      devices.forEach((device, index) => {
        const status = device.isActive 
          ? chalk.green('●') 
          : chalk.gray('○');
        const type = device.deviceType === 'android_watch' 
          ? '⌚ Watch' 
          : '📱 Phone';

        console.log(`${chalk.bold(index + 1)}. ${type} ${status}`);
        console.log(`   Name: ${device.deviceName || 'Unknown'}`);
        console.log(`   Last seen: ${formatLastSeen(device.lastSeenAt)}`);
        console.log('');
      });

    } catch (error) {
      console.log(chalk.red('Failed to list devices'));
      Logger.getInstance().error('List devices failed', { error });
    }
  });

const PairDeviceCommand = new Command('pair')
  .name('pair')
  .description('Pair a new device')
  .option('-t, --type <type>', 'Device type (phone|watch)', 'phone')
  .action(async (options: PairOptions) => {
    const config = await ConfigStore.load();
    const api = new ApiClient();

    try {
      if (!config.isAuthenticated()) {
        console.log(chalk.yellow('Not logged in'));
        console.log(chalk.gray('Run "agentapprove login" first\n'));
        return;
      }

      console.log(chalk.bold('\n📱 Device Pairing\n'));
      console.log('1. Open the Agent Watch app on your phone/watch');
      console.log('2. Go to Settings > Pair Device');
      console.log('3. Scan the QR code below\n');

      // Create pairing request
      const pairingData = await api.createPairingRequest(options.type as 'android_phone' | 'android_watch');

      // Show QR code
      console.log(chalk.bold('Pairing Code:'), chalk.cyan(pairingData.pairingCode));
      console.log('');
      
      if (pairingData.qrCodeUrl) {
        // Generate QR code for terminal
        qrcode.generate(pairingData.qrCodeUrl, { small: true });
      }

      console.log(chalk.gray('\nOr enter the code manually in the app'));
      console.log(chalk.gray('This code expires in 5 minutes\n'));

      // Wait for pairing
      console.log(chalk.cyan('Waiting for pairing...'));
      const result = await api.waitForPairing(pairingData.pairingCode, 300000);

      console.log(chalk.green('\n✓ Device paired successfully!'));
      console.log(chalk.bold('Device:'), result.device.deviceName);

    } catch (error) {
      console.log(chalk.red('\n✗ Pairing failed'));
      if (error instanceof Error && error.message === 'Pairing timeout') {
        console.log(chalk.gray('The pairing code has expired. Please try again.\n'));
      }
      Logger.getInstance().error('Pairing failed', { error });
    }
  });

const UnpairDeviceCommand = new Command('unpair')
  .name('unpair')
  .description('Unpair a device')
  .action(async () => {
    const config = await ConfigStore.load();
    const api = new ApiClient();

    try {
      if (!config.isAuthenticated()) {
        console.log(chalk.yellow('Not logged in'));
        return;
      }

      const devices = await api.getDevices();

      if (devices.length === 0) {
        console.log(chalk.yellow('No devices to unpair\n'));
        return;
      }

      const choices = devices.map((d, i) => ({
        name: `${d.deviceName || 'Device ' + (i + 1)} (${d.deviceType})`,
        value: d.id,
      }));

      const { deviceId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'deviceId',
          message: 'Select device to unpair:',
          choices,
        },
      ]);

      await api.unpairDevice(deviceId);
      console.log(chalk.green('\n✓ Device unpaired\n'));

    } catch (error) {
      console.log(chalk.red('\n✗ Unpair failed'));
      Logger.getInstance().error('Unpair failed', { error });
    }
  });

function formatLastSeen(lastSeenAt?: string): string {
  if (!lastSeenAt) return 'Never';
  const date = new Date(lastSeenAt);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  return date.toLocaleDateString();
}

interface PairOptions {
  type?: string;
}
