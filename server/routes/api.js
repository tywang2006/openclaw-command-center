import express from 'express';
import departmentsRouter from './departments.js';
import chatRouter from './chat.js';
import memoryRouter from './memory-routes.js';
import bulletinRouter from './bulletin-routes.js';
import subagentsRouter from './subagents-routes.js';
import broadcastRouter from './broadcast-routes.js';
import telegramRouter from './telegram-routes.js';
import activityRouter from './activity-routes.js';
import collaborationRouter from './collaboration-routes.js';
import layoutRouter from './layout-routes.js';
import { createLogger } from '../logger.js';

const log = createLogger('API');
const router = express.Router();

// Mount domain-specific route modules
router.use(departmentsRouter);
router.use(chatRouter);
router.use(memoryRouter);
router.use(bulletinRouter);
router.use(subagentsRouter);
router.use(broadcastRouter);
router.use(telegramRouter);
router.use(activityRouter);
router.use(collaborationRouter);
router.use(layoutRouter);

export default router;
