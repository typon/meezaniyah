import { createEffect, onCleanup, onMount } from 'solid-js';
import { Chart, LineController, BarController, DoughnutController, LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Filler, type ChartData, type ChartOptions } from 'chart.js';

Chart.register(LineController, BarController, DoughnutController, LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Filler);
type Kind = 'line' | 'bar' | 'doughnut';
export default function ChartCanvas(props: {type:Kind;data:ChartData;options?:ChartOptions;label:string}) {
  let canvas!:HTMLCanvasElement;
  let chart:Chart|undefined;
  const options=():ChartOptions=>({responsive:true,maintainAspectRatio:false,animation:false,normalized:true,plugins:{legend:{display:false},tooltip:{enabled:true}},elements:{point:{radius:0,hitRadius:8},line:{borderWidth:2,tension:0}},...props.options});
  onMount(()=>{chart=new Chart(canvas,{type:props.type,data:props.data,options:options()});});
  createEffect(()=>{const data=props.data;const config=options();if(chart){chart.data=data;chart.options=config;chart.update('none');}});
  onCleanup(()=>chart?.destroy());
  return <canvas ref={canvas} role="img" aria-label={props.label}>{props.label}</canvas>;
}
