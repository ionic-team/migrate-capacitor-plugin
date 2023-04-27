import {
  LOGGER_LEVELS,
  StreamOutputStrategy,
  TTYOutputStrategy,
  createDefaultLogger,
} from '@ionic/cli-framework-output';
import type { LoggerLevelWeight } from '@ionic/cli-framework-output';

import { isTTY } from './cli';
import c from './colors';

const options = {
  colors: c,
  stream: process.argv.includes('--json') ? process.stderr : process.stdout,
};

export const output = isTTY ? new TTYOutputStrategy(options) : new StreamOutputStrategy(options);

export const logger = createDefaultLogger({
  output,
  formatterOptions: {
    titleize: false,
    tags: new Map<LoggerLevelWeight, string>([
      [LOGGER_LEVELS.DEBUG, c.log.DEBUG('[debug]')],
      [LOGGER_LEVELS.INFO, c.log.INFO('[info]')],
      [LOGGER_LEVELS.WARN, c.log.WARN('[warn]')],
      [LOGGER_LEVELS.ERROR, c.log.ERROR('[error]')],
    ]),
  },
});

export function logSuccess(msg: string): void {
  logger.msg(`${c.success('[success]')} ${msg}`);
}
