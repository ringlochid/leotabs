// SPDX-License-Identifier: MPL-2.0
import { startQuick } from './quick.js';
import { toast } from './shared.js';
startQuick().catch((error) => toast(error.message, { error: true }));
