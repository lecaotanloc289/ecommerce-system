import { tsupPreset } from '@repo/config/tsup';
// @prisma/client is a runtime CJS dep — never bundle it.
export default tsupPreset({ external: ['@prisma/client'] });
