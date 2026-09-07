// SPDX-License-Identifier: MPL-2.0
import {rulesDialog} from './rules-dialog.js';
import {el,button,field,modal,task} from './shared.js';
import {policyFor,POLICY_CHOICES,sanitizePolicy} from '../lib/organisation.js';
import {providerEndpoint} from '../lib/providers.js';
import {endpointOrigin} from '../lib/integrations.js';
import {rpc} from './shared.js';

const names={keep:'Keep existing',rules:'Rules',ai:'AI','rules-ai':'Rules, then AI',template:'Template',manual:'Keep current order',title:'Alphabetical',domain:'Website',recent:'Recent activity',rule:'Rule priority'};
const labels={group:'Group tabs',collectionName:'Name collections',groupName:'Name groups',tabOrder:'Order tabs and saved links',groupOrder:'Order groups',collectionOrder:'Order collections'};
export function organisationDialog({state,scope={type:'global'},change}) {
  const collection=state.collections.find(c=>c.id===scope.id);
  const space=state.spaces.find(s=>s.id===(scope.type==='space'?scope.id:collection?.spaceId));
  const target=scope.type==='collection'?collection:scope.type==='space'?space:state.settings;
  const inherited=el('input',{type:'checkbox',checked:scope.type!=='global'&&!target?.organisation});
  const policy=policyFor(state,scope.type==='collection'?collection:null,scope.type==='global'?null:space?.id);
  const fields={};
  const form=el('div',{class:'organisation-fields'},...Object.entries(POLICY_CHOICES).filter(([key])=>scope.type!=='collection'||key!=='collectionOrder').map(([key,values])=>{
    const input=fields[key]=el('select',{'aria-label':labels[key]},...values.map(value=>el('option',{value,selected:value===policy[key]},names[value])));
    return field(labels[key],input);
  }));
  for(const [key,label] of [['collectionTemplate','Collection name template'],['groupTemplate','Group name template'],['orderInstruction','AI ordering purpose']]) {
    fields[key]=el('input',{value:policy[key],'aria-label':label});form.append(field(label,fields[key]));
  }
  const automatic=el('input',{type:'checkbox',checked:policy.automatic});
  form.append(el('label',{class:'check-label'},automatic,'Apply automatically to new work'));
  const update=()=>{for(const input of form.querySelectorAll('input,select'))input.disabled=scope.type!=='global'&&inherited.checked;};
  inherited.onchange=update;update();
  const body=el('div',{},
    scope.type!=='global'?el('label',{class:'check-label'},inherited,'Inherit '+(scope.type==='space'?'global defaults':'space defaults')):null,
    form,el('p',{class:'hint'},'Templates: {domain}, {title}, {count}, {date}, {space}, {name}. Manual names and placements are preserved.'),
    scope.type==='global'?button('Open grouping rules',()=>rulesDialog({state,change})):null);
  const status=el('p',{class:'hint',role:'status'});body.append(status);
  const refresh=async()=>{const result=await rpc('organisation-status',{scope});status.textContent=`${result.count} remembered manual exceptions.`+(result.error?' Last automatic AI attempt: '+result.error:'');};
  refresh().catch(error=>{status.textContent=error.message;});
  body.append(button('Forget manual exceptions',task(async()=>{await change('organisation-reset',{scope});await refresh();})));
  body.append(button('Retry automatic AI',task(async()=>{await change('organisation-retry',{});status.textContent='Automatic organisation queued.';})));
  body.append(button('Apply saved policy once',task(async()=>{
    if(Object.values(policy).some(v=>v==='ai'||v==='rules-ai')&&!await chrome.permissions.request({origins:[endpointOrigin(providerEndpoint(state.settings))+'/*']}))throw Error('AI access was not enabled.');
    await change('organisation-run',{scope});status.textContent='Organisation applied; any AI changes are queued.';
  })));
  const {close}=modal('Organisation · '+(scope.type==='global'?'Global defaults':target.name),body,[
    button('Cancel',()=>close()),
    button('Save',task(async()=>{
      const organisation=scope.type!=='global'&&inherited.checked?null:sanitizePolicy({...Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value])),automatic:automatic.checked});
      if(organisation?.automatic&&Object.values(organisation).some(v=>v==='ai'||v==='rules-ai')) {
        const granted=await chrome.permissions.request({origins:[endpointOrigin(providerEndpoint(state.settings))+'/*']});
        if(!granted)throw Error('AI access was not enabled. Your settings have not changed.');
      }
      const ruleValues=undefined;
      await change('organisation-policy',{scope,organisation,rules:ruleValues});close();
    }),{className:'primary'}),
  ]);
}
