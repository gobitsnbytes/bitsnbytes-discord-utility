import discord
from discord.ext import commands
import time

class General(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.start_time = time.time()

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"General Cog is ready.")

    @commands.command(name="sync")
    async def sync(self, ctx):
        """Sync commands to the current guild (Instant)."""
        await ctx.defer()
        self.bot.tree.copy_global_to(guild=ctx.guild)
        synced = await self.bot.tree.sync(guild=ctx.guild)
        await ctx.send(f"✅ Successfully synced `{len(synced)}` commands to this server!")

    @commands.hybrid_command(name="ping", description="Check the bot's latency and uptime.")
    async def ping(self, ctx):
        """Check how fast the bot is responding."""
        latency = round(self.bot.latency * 1000)
        uptime = self.get_uptime()
        
        embed = discord.Embed(
            title="🏓 Pong!",
            description=f"**Latency:** `{latency}ms`\n**Uptime:** `{uptime}`",
            color=discord.Color.blurple()
        )
        embed.set_footer(text=f"Requested by {ctx.author.name}", icon_url=ctx.author.display_avatar.url)
        await ctx.send(embed=embed)

    @commands.hybrid_command(name="help", description="Show all available commands.")
    async def help(self, ctx):
        """Show a beautiful list of all commands."""
        embed = discord.Embed(
            title="🤖 Antigravity Bot - Command List",
            description="Here are all the modules and commands available to you.",
            color=discord.Color.gold()
        )
        
        # We can dynamically pull commands from all cogs
        for name, cog in self.bot.cogs.items():
            command_list = ""
            for command in cog.get_commands():
                if not command.hidden:
                    command_list += f"`!{command.name}` - {command.description or 'No description'}\n"
            
            if command_list:
                embed.add_field(name=f"📦 {name} Module", value=command_list, inline=False)

        embed.set_thumbnail(url=self.bot.user.display_avatar.url)
        embed.set_footer(text="Use !help <command> for more info (coming soon).")
        await ctx.send(embed=embed)

    def get_uptime(self):
        delta = int(time.time() - self.start_time)
        hours, remainder = divmod(delta, 3600)
        minutes, seconds = divmod(remainder, 60)
        days, hours = divmod(hours, 24)
        
        parts = []
        if days > 0: parts.append(f"{days}d")
        if hours > 0: parts.append(f"{hours}h")
        if minutes > 0: parts.append(f"{minutes}m")
        parts.append(f"{seconds}s")
        return " ".join(parts)

async def setup(bot):
    await bot.add_cog(General(bot))
