import { useState } from 'react';
import { drawWinner } from '../utils/api';
import '../styles/theme.css';

export default function Home() {
  const [winner, setWinner] = useState(null);

  const handleDraw = async () => {
    const result = await drawWinner();
    setWinner(result.winner);
  };

  return (
    <div className="page">
      <h1>Alconbury‑Weald Lottery</h1>
      <button onClick={handleDraw}>Draw Winner</button>
      {winner && (
        <div className="winner-card">
          <h2>{winner.name}</h2>
          <p>{winner.email}</p>
          <p>{winner.plan}</p>
        </div>
      )}
    </div>
  );
}
