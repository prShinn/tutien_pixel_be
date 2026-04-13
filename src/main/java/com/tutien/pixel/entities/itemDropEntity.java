package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="item_drop")
public class itemDropEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String itemCode;
    private String itemName;
    private String questCode;
    private String questName;
    private String monsterCode;
    private String monsterName;
    private int tyLe;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }


    public String getItemName() {
        return itemName;
    }

    public void setItemName(String itemName) {
        this.itemName = itemName;
    }



    public String getQuestName() {
        return questName;
    }

    public void setQuestName(String questName) {
        this.questName = questName;
    }

    public String getItemCode() {
        return itemCode;
    }

    public void setItemCode(String itemCode) {
        this.itemCode = itemCode;
    }

    public String getQuestCode() {
        return questCode;
    }

    public void setQuestCode(String questCode) {
        this.questCode = questCode;
    }

    public String getMonsterCode() {
        return monsterCode;
    }

    public void setMonsterCode(String monsterCode) {
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
