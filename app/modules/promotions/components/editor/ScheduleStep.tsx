import { PolarisCheckbox } from "../PolarisControls";
import { FormSection } from "./shared";
import { DateTimeField } from "../DateTimeField";
import type { DiscountForm } from "./useDiscountForm";

export function ScheduleStep({ form }: { form: DiscountForm }) {
const { startDateTime, setStartDateTime, hasEndDate, setHasEndDate, endDateTime, setEndDateTime } = form;
return <>
<FormSection title="Schedule">
<div style={{display:"grid",gap:"12px"}}>
<DateTimeField label="Start date and time" value={startDateTime} onChange={setStartDateTime} />

<PolarisCheckbox
label="Set end date"
checked={hasEndDate}
onChange={(event)=>{
setHasEndDate(event.currentTarget.checked);
if(!event.currentTarget.checked){
setEndDateTime("");
}
}}
/>

{hasEndDate&&(
<DateTimeField label="End date and time" value={endDateTime} min={startDateTime||undefined} onChange={setEndDateTime} />
)}
</div>
</FormSection>
</>;
}
