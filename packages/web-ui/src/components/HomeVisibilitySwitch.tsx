import { Switch } from '@heroui/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t, useLocale } from '@edition/i18n';
import './HomeVisibilitySwitch.css';

type LibraryVisibility = { id:number; label:string; hideOnHome?:boolean };

export function HomeVisibilitySwitch({library,save}:{library:LibraryVisibility;save:(id:number,hidden:boolean)=>Promise<unknown>}) {
  useLocale();
  const client=useQueryClient();
  const mutation=useMutation({
    mutationFn:(hidden:boolean)=>save(library.id,hidden),
    onSuccess:async(_,hidden)=>{
      client.setQueryData<LibraryVisibility[]>(['libraries'],items=>items?.map(item=>item.id===library.id?{...item,hideOnHome:hidden}:item));
      await Promise.all([
        client.invalidateQueries({queryKey:['libraries']}),
        client.invalidateQueries({queryKey:['home']}),
        client.invalidateQueries({queryKey:['shorts','row']})
      ]);
    }
  });
  return <div className="home-visibility">
    <Switch isSelected={!(mutation.isPending?mutation.variables:library.hideOnHome)} isDisabled={mutation.isPending}
      onChange={shown=>mutation.mutate(!shown)} aria-label={t("Show {value0} on Home",{value0:library.label})}>
      <Switch.Content><span>{t("Show on Home")}</span><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content>
    </Switch>
    {mutation.isError&&<p className="error-copy" role="alert">{t("Could not save Home visibility.")}</p>}
  </div>;
}
