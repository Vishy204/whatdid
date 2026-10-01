import { VERSION } from '../core/util';
const handlers = require('./handlers');
export const routes = { '/version': () => VERSION };
