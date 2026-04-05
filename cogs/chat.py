import os
import discord
from discord.ext import commands
import google.generativeai as genai

class ChatAI(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.api_key = os.getenv('GEMINI_API_KEY')
        
        if self.api_key:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel('gemini-1.5-flash')
            # Memory: Store last few messages per channel
            self.history = {} 
        else:
            self.model = None

    @commands.Cog.listener()
    async def on_ready(self):
        print("ChatAI Cog is ready.")

    @commands.hybrid_command(name="chat", description="Ask the bot anything powered by Google Gemini.")
    async def chat(self, ctx, *, prompt: str):
        """Ask the AI a question."""
        if not self.model:
            return await ctx.send("❌ Gemini AI is not configured. Please add `GEMINI_API_KEY` to your `.env`.")

        await ctx.defer() # Essential for AI calls as they can take > 3 seconds

        try:
            # Simple context management: keep last 10 messages for current channel
            channel_id = ctx.channel.id
            if channel_id not in self.history:
                self.history[channel_id] = []
                
            # Append user prompt to history
            self.history[channel_id].append({"role": "user", "parts": [prompt]})
            
            # Limit history
            if len(self.history[channel_id]) > 20:
                self.history[channel_id] = self.history[channel_id][-20:]

            # Generate response
            response = self.model.generate_content(self.history[channel_id])
            
            # Append AI response to history
            self.history[channel_id].append({"role": "model", "parts": [response.text]})
            
            # Send result in a nice embed
            embed = discord.Embed(
                description=response.text,
                color=discord.Color.blue()
            )
            embed.set_author(name=f"Replying to {ctx.author.name}", icon_url=ctx.author.display_avatar.url)
            embed.set_footer(text="Powered by Gemini 1.5 Flash")
            
            # Handle long responses (Discord limit is 4096 for embeds, 2000 for regular messages)
            if len(response.text) > 4000:
                await ctx.send(response.text[:2000])
                await ctx.send(response.text[2000:4000])
            else:
                await ctx.send(embed=embed)
                
        except Exception as e:
            print(f"AI Error: {e}")
            await ctx.send(f"❌ Error communicating with AI: {e}")

    @commands.hybrid_command(name="reset-chat", description="Reset the AI's memory for this channel.")
    async def reset_chat(self, ctx):
        """Clear the conversation history for this channel."""
        channel_id = ctx.channel.id
        if channel_id in self.history:
            self.history[channel_id] = []
            await ctx.send("🔄 Conversation history cleared for this channel.")
        else:
            await ctx.send("Memory is already empty.")

async def setup(bot):
    await bot.add_cog(ChatAI(bot))
