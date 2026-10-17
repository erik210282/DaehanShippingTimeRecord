export const defaultBreakSettings={break_minutes:15,lunch_minutes:30};
export const plannedType=type=>['break','lunch'].includes(type);
export function plannedChange(event,patch,settings=defaultBreakSettings){
 const next={...event,...patch};if(!plannedType(next.type)||!('type' in patch)&&!('start_time' in patch))return next;
 const minutes=Number(patch.type?settings[next.type+'_minutes']:next.auto_minutes??(Number(next.minutes)>0?next.minutes:settings[next.type+'_minutes']));
 const match=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next.start_time||'');
 if(!match)return {...next,auto_minutes:minutes,end_time:'',minutes:''};
 const [h,m]=next.start_time.split(':').map(Number),end=(h*60+m+minutes)%1440;
 return {...next,auto_minutes:minutes,minutes,end_time:String(Math.floor(end/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0')};
}

export function downtimeTypeLabel(type,t,settings=defaultBreakSettings,event){
 const label=event?.code?[event.code,event.code_name].filter(Boolean).join(' - '):t('pr_downtime_'+type);if(!plannedType(type))return label;
 const minutes=event?.type===type?(event.auto_minutes??(Number(event.minutes)>0?event.minutes:settings[type+'_minutes'])):settings[type+'_minutes'];
 return label+' ('+minutes+' min)';
}
