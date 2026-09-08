// SPDX-License-Identifier: MPL-2.0
import {rpc} from './shared.js';
import {providerEndpoint} from '../lib/providers.js';
import {endpointOrigin} from '../lib/integrations.js';
export async function assist(state,data) {
  const granted=await chrome.permissions.request({origins:[endpointOrigin(providerEndpoint(state.settings))+'/*']});
  if(!granted)throw Error('Allow access to the AI provider to continue');
  return rpc('ai-assist',data);
}
