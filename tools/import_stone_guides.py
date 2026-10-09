"""Import matching Korean guides; never changes encrypted manuscript/image data."""
import concurrent.futures, json, pathlib, re, subprocess, unicodedata, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE="https://grand-pasca-8d267f.netlify.app/"
def normalized(name):
    return re.sub(r"[\s·ㆍ\-]", "", unicodedata.normalize("NFKC", name)).casefold()
def select_matches(stones, catalog):
    names={}
    for guide in catalog:
        for name in [guide["name"], guide.get("alias", "")]:
            if name: names.setdefault(normalized(name), []).append(guide)
    matches=[];unmatched=[]
    for stone in stones:
        title=stone["title"]
        candidates={g["audio"]:g for g in names.get(normalized(title), []) if g.get("audio")}
        if len(candidates)==1:
            matches.append((stone,next(iter(candidates.values()))))
        elif len(candidates)>1:
            raise ValueError("Ambiguous guide: "+title)
        else: unmatched.append({"number":stone["num"],"title":title})
    return matches,unmatched
def download(pair):
    stone,guide=pair
    number=str(stone["num"])
    if not re.fullmatch(r"\d+(?:-\d+)?",number): raise ValueError("Invalid stone number")
    path=guide["audio"]
    if not re.fullmatch(r"audio/[a-z0-9.-]+\.m4a",path):raise ValueError("Invalid source")
    tmp=ROOT/"stones"/"audio"/(number+"-guide-source.m4a")
    out=tmp.with_name(number+"-guide.mp3")
    req=urllib.request.Request(BASE+path,headers={"User-Agent":"sayeon-guide-import"})
    try:
        with urllib.request.urlopen(req,timeout=90) as response, tmp.open("wb") as target:
            if urllib.parse.urlparse(response.url).hostname!="grand-pasca-8d267f.netlify.app":
                raise ValueError("Unexpected audio redirect")
            total=0
            while chunk:=response.read(65536):
                total+=len(chunk)
                if total>50_000_000:raise ValueError("Guide too large")
                target.write(chunk)
        subprocess.run(["ffmpeg","-v","error","-y","-i",str(tmp),"-vn","-ac","1","-ar","44100","-b:a","48k",str(out)],check=True)
        duration=float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",str(out)]))
        expected=float(guide["duration"])
        if abs(duration-expected)>max(3,expected*.03):raise ValueError("Unexpected guide duration: "+guide["name"])
        if out.stat().st_size<1000:raise ValueError("Empty recording")
        return {"number":number,"title":stone["title"],"guide":guide["name"],"source":BASE+path,"duration":round(duration,2),"path":"audio/"+out.name}
    finally:
        tmp.unlink(missing_ok=True)
def main():
    import sys
    sys.path.insert(0,str(ROOT/"tools"))
    import crypt
    stones=crypt.read_json(str(ROOT/"stones"/"stones.json"))
    catalog=json.loads((ROOT/"stones"/"guide-catalog.json").read_text())
    matches,unmatched=select_matches(stones,catalog)
    if not matches:raise ValueError("No exact title matches; no changes made")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        imported=list(pool.map(download,matches))
    html=ROOT/"stones"/"index.html"
    text=html.read_text()
    match=re.search(r"^const GUIDE_AUDIO = (\{.*\});$",text,re.M)
    if not match:raise ValueError("Guide map missing")
    audio=json.loads(match[1])
    for item in imported:audio[item["number"]]=item["path"]
    text=text[:match.start()]+"const GUIDE_AUDIO = "+json.dumps(audio,ensure_ascii=False,separators=(",",":"))+";"+text[match.end():]
    html.write_text(text)
    report={"source":BASE,"imported":imported,"unmatchedGuides":[g["name"] for g in catalog if g["audio"] not in {x[1]["audio"] for x in matches}],"unmatchedStones":unmatched}
    (ROOT/"stones"/"guide-import-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(report,ensure_ascii=False))
    history=ROOT/"UPDATE_HISTORY.md"
    history.write_text("## 2026-10-09 월명동 가이드 녹음 연결\n- 제공된 Netlify 한국어 가이드와 작품 제목(공백·가운뎃점·붙임표 제외) 또는 명시된 별칭이 일치하는 "+str(len(imported))+"개 작품에 가이드 듣기를 연결했다. 유사 이름은 추측하지 않았다.\n- 음성을 앱 저장소에 48kbps 모노 MP3로 저장하고 실제 길이·디코딩을 검사했다. 원고·사진·기존 녹음은 그대로 두었다.\n- 매칭과 원본 주소는 stones/guide-import-report.json에 기록했다.\n\n"+history.read_text())
if __name__=="__main__":main()
