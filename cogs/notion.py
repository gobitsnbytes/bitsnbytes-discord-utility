import os
import discord
from discord import ui
from discord.ext import commands
from notion_client import Client
from datetime import datetime

# Modal for adding tasks to Notion
class NotionAddModal(ui.Modal, title="➕ Add Task to Notion"):
    task_name = ui.TextInput(
        label="Task Name",
        placeholder="Enter the task title...",
        required=True,
        max_length=100
    )
    description = ui.TextInput(
        label="Description",
        style=discord.TextStyle.paragraph,
        placeholder="Enter more details about the task...",
        required=False,
        max_length=400
    )

    def __init__(self, notion_client, database_id):
        super().__init__()
        self.notion = notion_client
        self.db_id = database_id

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        
        try:
            # CREATE operation in Notion
            self.notion.pages.create(
                parent={"database_id": self.db_id},
                properties={
                    "Name": {"title": [{"text": {"content": self.task_name.value}}]},
                    "Description": {"rich_text": [{"text": {"content": self.description.value or "N/A"}}]}
                }
            )
            
            embed = discord.Embed(
                title="✅ Task Added to Notion",
                description=f"**Task:** {self.task_name.value}",
                color=discord.Color.green(),
                timestamp=datetime.utcnow()
            )
            await interaction.followup.send(embed=embed)
        except Exception as e:
            print(f"Notion Error: {e}")
            await interaction.followup.send(f"❌ Failed to add to Notion: {e}", ephemeral=True)

class Notion(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.notion_token = os.getenv('NOTION_TOKEN')
        self.db_id = os.getenv('NOTION_DATABASE_ID')
        
        # Initialize Notion Client
        if self.notion_token:
            self.notion = Client(auth=self.notion_token)
        else:
            self.notion = None

    @commands.hybrid_command(name="n-add", description="Add a new entry to the Notion database.")
    async def notion_add(self, ctx):
        """Open a popup to add a task to Notion."""
        if not self.notion or not self.db_id:
            return await ctx.send("❌ Notion API is not configured. Please check your `.env` file.")
        
        # Send the modal
        # Note: Hybrid commands need careful handling for modals
        if ctx.interaction:
            await ctx.interaction.response.send_modal(NotionAddModal(self.notion, self.db_id))
        else:
            await ctx.send("Please use the Slash Command `/n-add` to open the input form.")

    @commands.hybrid_command(name="n-list", description="List the latest entries from Notion.")
    async def notion_list(self, ctx):
        """Fetch and display recent Notion entries."""
        if not self.notion or not self.db_id:
            return await ctx.send("❌ Notion API is not configured.")
        
        await ctx.defer()
        
        try:
            # READ operation (Query)
            results = self.notion.databases.query(
                database_id=self.db_id,
                page_size=5
            ).get("results")
            
            embed = discord.Embed(
                title="🗒️ Recent Notion Tasks",
                color=discord.Color.blue(),
                timestamp=datetime.utcnow()
            )
            
            if not results:
                embed.description = "No tasks found in the database."
            else:
                for page in results:
                    # Parse properties (Handles 'Name' or 'title' automatically)
                    props = page.get("properties")
                    # Try to get the title from the first 'title' field
                    title_field = next((v for k, v in props.items() if v["type"] == "title"), None)
                    title = title_field["title"][0]["text"]["content"] if title_field and title_field["title"] else "Untitled"
                    
                    page_id = page["id"]
                    embed.add_field(
                        name=f"📌 {title}", 
                        value=f"ID: `{page_id}`\n[Open in Notion]({page['url']})", 
                        inline=False
                    )
            
            embed.set_footer(text="Showing last 5 entries")
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"❌ Error fetching from Notion: {e}")

    @commands.hybrid_command(name="n-archive", description="Archive a Notion page by its ID.")
    async def notion_archive(self, ctx, page_id: str):
        """Archive (Delete) a specific page."""
        if not self.notion: return
        
        try:
            # DELETE (Archive) operation
            self.notion.pages.update(page_id=page_id, archived=True)
            await ctx.send(f"✅ Successfully archived page `{page_id}`.")
        except Exception as e:
            await ctx.send(f"❌ Failed to archive: {e}")

async def setup(bot):
    await bot.add_cog(Notion(bot))
