package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="item_drop")
public class itemDropEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private int itemCode;
    private String itemName;
    private int questCode;
    private String questName;
    private int monsterCode;
    private String monsterName;
    private int tyLe;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public int getItemCode() {
        return itemCode;
    }

    public void setItemCode(int itemCode) {
        this.itemCode = itemCode;
    }

    public String getItemName() {
        return itemName;
    }

    public void setItemName(String itemName) {
        this.itemName = itemName;
    }

    public int getQuestCode() {
        return questCode;
    }

    public void setQuestCode(int questCode) {
        this.questCode = questCode;
    }

    public String getQuestName() {
        return questName;
    }

    public void setQuestName(String questName) {
        this.questName = questName;
    }

    public int getMonsterCode() {
        return monsterCode;
    }

    public void setMonsterCode(int monsterCode) {
        this.monsterCode = monsterCode;
    }

    public String getMonsterName() {
        return monsterName;
    }

    public void setMonsterName(String monsterName) {
        this.monsterName = monsterName;
    }

    public int getTyLe() {
        return tyLe;
    }

    public void setTyLe(int tyLe) {
        this.tyLe = tyLe;
    }
}
