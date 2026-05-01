interface ElevenLabsConfig {
  apiKey: string;
  voiceId?: string;
}

export class ElevenLabsProvider {
  private apiKey: string;
  private voiceId: string;
  private isDemoMode: boolean;

  constructor(config?: ElevenLabsConfig) {
    this.isDemoMode = process.env.DISABLE_EXTERNAL_API === "true";
    this.apiKey = config?.apiKey || process.env.ELEVENLABS_API_KEY || "";
    this.voiceId = config?.voiceId || "21m00Tcm4TlvDq8ikWAM"; // Default voice
  }

  /**
   * Generate speech from text
   * @param text - Text to convert to speech
   * @param options - Voice options
   * @returns Audio buffer and duration
   */
  async textToSpeech(
    text: string,
    options?: {
      voiceId?: string;
      stability?: number;
      similarity_boost?: number;
    }
  ): Promise<{ audioBuffer: Buffer; duration: number; url?: string }> {
    if (this.isDemoMode) {
      return {
        audioBuffer: Buffer.from("mock_audio_data"),
        duration: 3.5,
        url: "https://example.com/mock_audio.mp3"
      };
    }

    if (!this.apiKey) {
      throw new Error("ElevenLabs API key not configured");
    }

    const voiceId = options?.voiceId || this.voiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    let lastError: Error | null = null;
    for (let i = 0; i < 3; i++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": this.apiKey
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: options?.stability || 0.5,
              similarity_boost: options?.similarity_boost || 0.75
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
        }

        const audioBuffer = Buffer.from(await response.arrayBuffer());

        // Estimate duration based on text length (rough approximation)
        const estimatedDuration = Math.ceil(text.split(" ").length * 0.4);

        return {
          audioBuffer,
          duration: estimatedDuration,
        };
      } catch (error) {
        lastError = error as Error;
        console.error(`ElevenLabs attempt ${i + 1} failed:`, error);
        if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }

    throw lastError || new Error("Failed after 3 attempts");
  }

  /**
   * Clone a voice from audio samples
   * @param name - Voice name
   * @param audioFiles - Audio file buffers
   * @returns Voice ID
   */
  async cloneVoice(name: string, audioFiles: Buffer[]): Promise<{ voiceId: string }> {
    if (this.isDemoMode) {
      return { voiceId: `mock_voice_${Date.now()}` };
    }

    if (!this.apiKey) {
      throw new Error("ElevenLabs API key not configured");
    }

    const formData = new FormData();
    formData.append("name", name);

    audioFiles.forEach((buffer, index) => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      formData.append("files", blob, `sample_${index}.mp3`);
    });

    const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs voice clone error: ${error}`);
    }

    const data = await response.json();
    return { voiceId: data.voice_id };
  }

  /**
   * List available voices
   */
  async listVoices(): Promise<any[]> {
    if (this.isDemoMode) {
      return [
        { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
        { voice_id: "mock_clone_1", name: "Custom Voice", category: "cloned" }
      ];
    }

    if (!this.apiKey) {
      return [];
    }

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": this.apiKey
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.voices || [];
  }
}
