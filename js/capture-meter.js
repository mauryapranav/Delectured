// The meter reads the existing microphone source; it neither owns nor stops capture.
export function startCaptureMeter(recorder, canvas) {
    if (!recorder?.audioContext || !recorder?.source || !canvas) return () => {};
    const analyser = recorder.audioContext.createAnalyser(); analyser.fftSize = 256;
    recorder.source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize), ctx = canvas.getContext('2d'); let frame, active = true;
    function draw() {
        if (!active) return;
        analyser.getByteTimeDomainData(samples); ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--muted').trim(); ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i=0;i<samples.length;i++) {const x=i/(samples.length-1)*canvas.width, y=canvas.height/2+(samples[i]-128)/128*canvas.height*.48; if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}
        ctx.stroke(); frame=requestAnimationFrame(draw);
    }
    draw();
    return () => {active=false;cancelAnimationFrame(frame);try{recorder.source.disconnect(analyser);}catch{}analyser.disconnect();ctx.clearRect(0,0,canvas.width,canvas.height);};
}
