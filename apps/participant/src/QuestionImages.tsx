export type QuestionImage={id:string;url:string;mime_type?:string|null;alt?:string}

export default function QuestionImages({media}:{media?:QuestionImage[]}){
 if(!media?.length)return null
 return <div className="questionMedia">{media.map(m=><img key={m.id} src={m.url} alt={m.alt||'Question image'} loading="eager" decoding="async"/>)}</div>
}
