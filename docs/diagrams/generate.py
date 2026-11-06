# Regenerates the .excalidraw diagrams: python3 docs/diagrams/generate.py docs/diagrams
import json, sys
OUT = sys.argv[1]
C = dict(blue="#a5d8ff", green="#b2f2bb", orange="#ffd8a8", purple="#d0bfff", red="#ffc9c9", yellow="#fff3bf", teal="#c3fae8", gray="#e9ecef", zone="#f8f9fa")

class D:
    def __init__(s): s.el=[]; s.n=0; s.shapes={}
    def id(s,p): s.n+=1; return f"{p}{s.n}"
    def text(s,x,y,t,size=20,color="#1e1e1e"):
        s.el.append(dict(type="text",id=s.id("t"),x=x,y=y,width=len(t)*size*0.55,height=size*1.3,text=t,originalText=t,fontSize=size,fontFamily=1,strokeColor=color,autoResize=True))
    def zone(s,x,y,w,h,title,color=C["zone"]):
        s.el.append(dict(type="rectangle",id=s.id("z"),x=x,y=y,width=w,height=h,backgroundColor=color,fillStyle="solid",strokeStyle="dashed",strokeColor="#868e96",roundness={"type":3}))
        s.text(x+16,y+10,title,18,"#495057")
    def box(s,key,x,y,w,h,t,fill="blue",size=17,shape="rectangle"):
        bid=s.id("b"); tid=s.id("bt")
        s.el.append(dict(type=shape,id=bid,x=x,y=y,width=w,height=h,backgroundColor=C[fill],fillStyle="solid",roundness={"type":3},boundElements=[{"id":tid,"type":"text"}]))
        s.el.append(dict(type="text",id=tid,x=x+6,y=y+6,width=w-12,height=h-12,text=t,originalText=t,fontSize=size,fontFamily=1,textAlign="center",verticalAlign="middle",containerId=bid,autoResize=True,strokeColor="#1e1e1e"))
        s.shapes[key]=(bid,x,y,w,h)
    def arrow(s,a,b,label=None,dashed=False,sa=None,sb=None,bend=None):
        A=s.shapes[a]; B=s.shapes[b]
        def pt(S,side):
            _,x,y,w,h=S
            return {"r":(x+w,y+h/2),"l":(x,y+h/2),"t":(x+w/2,y),"b":(x+w/2,y+h)}[side], {"r":[1,0.5],"l":[0,0.5],"t":[0.5,0],"b":[0.5,1]}[side]
        if sa is None or sb is None:
            ax,ay=A[1]+A[3]/2,A[2]+A[4]/2; bx,by=B[1]+B[3]/2,B[2]+B[4]/2
            if abs(bx-ax)>abs(by-ay): sa,sb=("r","l") if bx>ax else ("l","r")
            else: sa,sb=("b","t") if by>ay else ("t","b")
        (x1,y1),f1=pt(A,sa); (x2,y2),f2=pt(B,sb)
        aid=s.id("a"); pts=[[0,0],[x2-x1,y2-y1]]
        if bend: pts=[[0,0],[bend[0]-x1,bend[1]-y1],[x2-x1,y2-y1]]
        e=dict(type="arrow",id=aid,x=x1,y=y1,width=abs(x2-x1),height=abs(y2-y1),points=pts,endArrowhead="arrow",strokeStyle="dashed" if dashed else "solid",
               startBinding={"elementId":A[0],"fixedPoint":f1},endBinding={"elementId":B[0],"fixedPoint":f2})
        if label:
            tid=s.id("at"); e["boundElements"]=[{"id":tid,"type":"text"}]
            s.el.append(e)
            s.el.append(dict(type="text",id=tid,x=(x1+x2)/2-40,y=(y1+y2)/2-10,width=80,height=20,text=label,originalText=label,fontSize=15,fontFamily=1,textAlign="center",verticalAlign="middle",containerId=aid,autoResize=True,strokeColor="#495057"))
        else: s.el.append(e)
    def save(s,name):
        json.dump({"type":"excalidraw","version":2,"source":"clutch","elements":s.el,"appState":{"viewBackgroundColor":"#ffffff"}},open(f"{OUT}/{name}.excalidraw","w"),indent=1)

# 1. System architecture
d=D()
d.text(40,20,"Clutch: system architecture",30)
d.text(40,64,"AI opens markets on live streams, two readers settle them, Uniswap v4 hooks hold the money, World ID keeps it one person per limit",16,"#495057")
d.zone(30,110,300,560,"Sources")
d.box("tw",60,160,240,70,"Twitch / Kick / YouTube\nlive video","orange")
d.box("li",60,260,240,70,"Lichess\n(two independent feeds)","orange")
d.box("chat",60,360,240,70,"Twitch chat\n(IRC read, Helix send)","orange")
d.box("wid",60,470,240,80,"World ID\nProof of Human, Agent Pass","green")
d.zone(370,110,520,560,"Clutch engine (Node)")
d.box("cap",400,160,200,70,"Frame capture\nstreamlink + ffmpeg","gray")
d.box("ra",640,160,220,70,"Reader A (0G)\nclaude-haiku-5.5","purple")
d.box("agent",640,260,220,80,"Market agent (0G)\npicks counter, rule, price","purple")
d.box("rb",640,370,220,70,"Reader B (0G)\n0gm-1.0 / gemini fallback","purple")
d.box("res",400,370,200,70,"Resolver\nboth agree, else VOID","gray")
d.box("pass",400,470,200,80,"Pass signer\nIDKit verify, Agent Pass","gray")
d.box("ev",640,470,220,80,"Evidence bundle\n0G Storage Merkle root","teal")
d.box("api",400,590,460,55,"API + WebSocket · indexer · auto-payouts · keeper","gray")
d.zone(930,110,420,560,"Chain (Base / Unichain, OP Stack)")
d.box("pm",960,160,360,70,"Uniswap v4 PoolManager\n(one singleton, flash accounting)","blue")
d.box("ch",960,260,170,90,"ClutchHook\nLMSR in beforeSwap\nERC-6909 stakes","blue",15)
d.box("bg",1150,260,170,90,"BlackoutGuardHook\nauction fee after\nsequencer outage","blue",15)
d.box("sg",960,380,360,60,"SequencerGuard (shared by both hooks)","blue")
d.box("gate",960,470,170,80,"HumanPassGate\ncap per human","green",15)
d.box("vault",1150,470,170,80,"LP vault\nfunds worst case","green",15)
d.box("router",960,570,360,80,"ClutchRouter\nback · backWithEth · backWithEthFor","blue",16)
d.zone(1390,110,300,560,"People")
d.box("viewer",1420,160,240,70,"Viewer\nsign in, one tap","yellow")
d.box("streamer",1420,270,240,70,"Streamer\nclaim, overlay, veto","yellow")
d.box("ag",1420,380,240,80,"Trading agent\nWorld Agent Pass","yellow")
d.box("relay",1420,570,240,80,"Relay solvers\nbridge + call from any chain","orange",16)
d.arrow("tw","cap","frames"); d.arrow("cap","ra"); d.arrow("ra","agent","counters"); d.arrow("agent","pm","openMarket",sa="r",sb="l")
d.arrow("cap","rb",None); d.arrow("rb","res","own frames",sa="l",sb="r"); d.arrow("res","ev",None,sa="b",sb="l",bend=(500,510)) if False else d.arrow("res","ev","bundle",sa="r",sb="l")
d.arrow("ev","pm","resolve(root)",sa="r",sb="l")
d.arrow("li","res","moves A/B")
d.arrow("pm","ch",None,sa="b",sb="t"); d.arrow("pm","bg",None,sa="b",sb="t")
d.arrow("ch","sg",None,sa="b",sb="t"); d.arrow("bg","sg",None,sa="b",sb="t")
d.arrow("viewer","router","trade",sa="l",sb="r"); d.arrow("ag","router","trade",sa="l",sb="r")
d.arrow("wid","pass","verify",sa="r",sb="l"); d.arrow("relay","router","signed bet",sa="l",sb="r")
d.arrow("chat","api",None,dashed=True)
d.save("architecture")

# 2. Life of a market
d=D()
d.text(40,20,"Life of a market (about 60 seconds)",30)
steps=[("Watch","Reader A reads a frame\nevery few seconds:\nscore, kill feed, players left","purple"),
       ("Open","Agent picks a contested\ncounter, writes the rule,\nprices it; rule hash onchain","purple"),
       ("Trade","One tap, Yes or No.\nLMSR prices every trade.\nTrading locks at lockTime","blue"),
       ("Buffer","Window starts after\nlock + stream-delay buffer\n(enforced in the hook)","yellow"),
       ("Settle","Reader B reads its own\nframes. Agree: pay.\nDisagree or missing: VOID","green"),
       ("Receipt","Rule, both verdicts, frames,\n0G request IDs, evidence\nroot, settlement tx","teal")]
for i,(t,b,f) in enumerate(steps):
    x=40+i*270
    d.box(f"s{i}",x,110,230,60,t,f,22)
    d.box(f"d{i}",x,190,230,130,b,"gray",16)
    d.arrow(f"s{i}",f"d{i}",None,sa="b",sb="t")
    if i: d.arrow(f"s{i-1}",f"s{i}",None,sa="r",sb="l")
d.text(40,350,"Guarantees",22)
for i,g in enumerate(["No market about a moment anyone has seen: windowStart >= lockTime + latencyBuffer reverts otherwise",
                      "No single model decides: two model families, separate frames and connections",
                      "No guessing: a reader with no data has no verdict, and the market voids with a full refund",
                      "No insider edge: the streamer's human ID can't trade their own markets; caps follow the person",
                      "No chain-outage edge: Blackout Guard voids markets whose trading overlapped a sequencer outage"]):
    d.text(60,390+i*32,"- "+g,17,"#343a40")
d.save("market-lifecycle")

# 3. One tap from any chain
d=D()
d.text(40,20,"One tap from any chain: Relay + two v4 hooks in one unlock",30)
d.box("u",40,120,220,80,"Viewer on Ethereum\n(ETH, no USDC)","yellow")
d.box("sig",40,240,220,80,"Signs Bet (EIP-712)\nmarket, side, deadline","yellow",16)
d.box("rl",330,120,240,80,"Relay\nsolver fills on Base\nin ~2s","orange")
d.zone(640,100,760,330,"ClutchRouter.backWithEthFor  ·  one PoolManager.unlock")
d.box("v",670,150,200,90,"verify signature\nnonce, deadline","gray",16)
d.box("s1",900,150,220,90,"swap ETH -> USDC\nBlackout Guard pool\n(+USDC credit)","blue",16)
d.box("s2",1150,150,220,90,"swap USDC -> shares\nClutchHook (LMSR)\n(-USDC debt)","blue",16)
d.box("net",670,290,450,90,"USDC credit and debt net to zero:\nUSDC never leaves the PoolManager.\nOnly the ETH in is settled.","green",16)
d.box("ok",1150,470,220,80,"Position credited\nto the signer","green")
d.box("pad",0,0,1,1,"","gray") if False else None
d.box("rf",760,470,260,80,"Unlock reverts (market locked)?\nETH sent to the trader,\nnothing stuck","red",15)
d.arrow("u","sig",None,sa="b",sb="t"); d.arrow("u","rl","deposit tx"); d.arrow("sig","rl","signed bet",sa="r",sb="b")
d.arrow("rl","v","call",sa="r",sb="l"); d.arrow("v","s1",None); d.arrow("s1","s2",None); d.arrow("s2","ok",None,sa="b",sb="t")
d.arrow("net","rf","if refused",dashed=True,sa="b",sb="t")
d.text(640,580,"Shared SequencerGuard: during an L2 outage the onramp pool charges the auction fee and the market refuses.",16,"#495057")
d.save("one-tap-any-chain")
print("ok")
