import { Switch } from '@heroui/react';

export function AccountToggle({title,description,checked,onChange,disabled=false}: {
  title:string;description?:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean
}) {
  return <div className="account-toggle"><div><strong>{title}</strong>{description&&<p>{description}</p>}</div>
    <Switch aria-label={title} isSelected={checked} isDisabled={disabled} onChange={onChange}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div>;
}
