import { mistyServerMethods, MISTY_APP_PROTOCOL_VERSION } from '@misty/contracts';
process.stdout.write(JSON.stringify({ protocol: MISTY_APP_PROTOCOL_VERSION, methods: mistyServerMethods }, null, 2) + '\n');
