
async function sampleTrainingData() {
  try {
    const response = await fetch('/api/nnue/training-data');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    console.log("--- Sample of Training Data (first 2 entries) ---");
    console.log(JSON.stringify(data.slice(0, 2), null, 2));
    console.log("--- Total samples fetched ---");
    console.log(data.length);
  } catch (err) {
    console.error("Failed to fetch training data:", err);
  }
}

sampleTrainingData();
